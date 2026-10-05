"""Select a saved camera on a specifically addressed, open dashboard card."""

from __future__ import annotations

import asyncio
import math
from typing import Any
from uuid import uuid4

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError

from .const import (
    DATA_PRESET_REQUESTS,
    DATA_PRESET_TARGETS,
    DOMAIN,
    EVENT_SELECT_VIEW,
    PRESET_RESPONSE_TIMEOUT,
    SERVICE_SELECT_VIEW,
    WS_PRESET_RESULT,
    WS_PRESET_SUBSCRIBE,
)

KEY = vol.All(str, vol.Strip, vol.Length(min=1, max=64))
TEXT = vol.All(str, vol.Strip, vol.Length(min=1, max=128))


def _finite(value: float) -> float:
    if not math.isfinite(value):
        raise vol.Invalid("must be a finite number")
    return value


def _target(data: dict[str, Any]) -> dict[str, Any]:
    if not data.get("panel") and not data.get("card_id"):
        raise vol.Invalid("provide panel or card_id to address the intended dashboard card")
    return data


SELECT_VIEW_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Required("layout_key"): KEY,
            vol.Required("preset"): TEXT,
            vol.Optional("panel"): TEXT,
            vol.Optional("card_id"): TEXT,
            vol.Optional("mode"): vol.In(("3d", "top")),
            vol.Optional("return_after"): vol.All(
                vol.Coerce(float), _finite, vol.Range(min=0, max=86400)
            ),
        }
    ),
    _target,
)


@callback
def async_register_services(hass: HomeAssistant) -> None:
    """Register during integration setup, even before a config entry is loaded."""
    if hass.services.has_service(DOMAIN, SERVICE_SELECT_VIEW):
        return
    pending: dict[str, dict[str, Any]] = hass.data.setdefault(DATA_PRESET_REQUESTS, {})
    targets: dict[str, dict[str, Any]] = hass.data.setdefault(DATA_PRESET_TARGETS, {})

    async def select_view(call: ServiceCall) -> ServiceResponse:
        if DOMAIN not in hass.data:
            raise ServiceValidationError("Add the Taylor's 3D integration before selecting a camera preset")
        matches = [
            (target_id, target) for target_id, target in targets.items()
            if all(target.get(key) == call.data[key] for key in ("layout_key", "panel", "card_id") if key in call.data)
        ]
        if not matches:
            raise ServiceValidationError(
                "No open Taylor's 3D card matches this target. Open its dashboard and check "
                "layout_key, panel and card_id match its card settings"
            )
        if len(matches) != 1:
            raise ServiceValidationError(
                "Several open Taylor's 3D cards match this target. Give each intended card a "
                "unique panel/card ID, include card_id when a panel has several cards, "
                "or close duplicate copies of the dashboard"
            )
        target_id, target = matches[0]
        request_id = uuid4().hex
        request = {**call.data, "request_id": request_id, "target_id": target_id}
        future = asyncio.get_running_loop().create_future()
        pending[request_id] = {"request": request, "future": future, "connection": target["connection"]}
        try:
            hass.bus.async_fire(EVENT_SELECT_VIEW, request, context=call.context)
            try:
                async with asyncio.timeout(PRESET_RESPONSE_TIMEOUT):
                    result = await future
            except TimeoutError as err:
                raise ServiceValidationError(
                    "The requested Taylor's 3D card did not respond. Open its dashboard, "
                    "then check layout_key, panel and card_id match its card settings"
                ) from err
            if result["status"] != "selected":
                reason = result.get("message") or result["status"]
                raise ServiceValidationError(f"Taylor's 3D could not select '{call.data['preset']}': {reason}")
            if call.return_response:
                return {
                    "layout_key": call.data["layout_key"],
                    "view_id": result["view_id"],
                    "mode": result["mode"],
                    **{k: result[k] for k in ("panel", "card_id") if k in result},
                }
            return None
        finally:
            pending.pop(request_id, None)

    hass.services.async_register(
        DOMAIN,
        SERVICE_SELECT_VIEW,
        select_view,
        schema=SELECT_VIEW_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    websocket_api.async_register_command(hass, ws_preset_result)
    websocket_api.async_register_command(hass, ws_subscribe_presets)


@websocket_api.websocket_command(vol.All(vol.Schema({
    vol.Required("type"): WS_PRESET_SUBSCRIBE,
    vol.Required("layout_key"): KEY,
    vol.Optional("panel"): TEXT,
    vol.Optional("card_id"): TEXT,
}), _target))
@callback
def ws_subscribe_presets(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Expose just camera requests to authenticated cards, including non-admin panels.

    HA's general subscribe_events endpoint restricts custom event names to admins.
    This dedicated subscription does not expose unrelated Home Assistant events.
    """
    targets = hass.data[DATA_PRESET_TARGETS]
    target_id = uuid4().hex
    targets[target_id] = {
        **{key: msg[key] for key in ("layout_key", "panel", "card_id") if key in msg},
        "connection": connection,
    }

    @callback
    def forward(event: Event) -> None:
        if event.data.get("target_id") == target_id:
            connection.send_event(msg["id"], {"event_type": EVENT_SELECT_VIEW, "data": event.data})

    remove_listener = hass.bus.async_listen(EVENT_SELECT_VIEW, forward)

    @callback
    def unsubscribe() -> None:
        remove_listener()
        targets.pop(target_id, None)

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_PRESET_RESULT,
        vol.Required("request_id"): KEY,
        vol.Required("target_id"): KEY,
        vol.Required("layout_key"): KEY,
        vol.Required("status"): vol.In(
            ("selected", "invalid_preset", "ambiguous_preset", "not_ready", "failed")
        ),
        vol.Optional("panel"): TEXT,
        vol.Optional("card_id"): TEXT,
        vol.Optional("view_id"): TEXT,
        vol.Optional("mode"): vol.In(("3d", "top")),
        vol.Optional("message"): vol.All(str, vol.Length(max=512)),
    }
)
@callback
def ws_preset_result(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """An authenticated matching card confirms the request; this does not edit storage."""
    item = hass.data.get(DATA_PRESET_REQUESTS, {}).get(msg["request_id"])
    if item is None or item["future"].done():
        connection.send_error(msg["id"], "stale_request", "The preset request has already finished")
        return
    request = item["request"]
    if connection is not item["connection"] or msg["target_id"] != request["target_id"]:
        connection.send_error(msg["id"], "wrong_target", "Only the addressed card connection may confirm this request")
        return
    if any(msg.get(k) != request[k] for k in ("layout_key", "panel", "card_id") if k in request):
        connection.send_error(msg["id"], "wrong_target", "The reply does not match the requested card")
        return
    if msg["status"] == "selected" and not (msg.get("view_id") and msg.get("mode")):
        connection.send_error(msg["id"], "invalid_result", "A selected preset requires view_id and mode")
        return
    item["future"].set_result({k: v for k, v in msg.items() if k not in ("id", "type", "request_id")})
    connection.send_result(msg["id"])
