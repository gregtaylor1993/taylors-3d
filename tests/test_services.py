"""Camera preset actions report actual matching card acknowledgements."""

import asyncio

import pytest
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.setup import async_setup_component

from custom_components.taylors3d import services
from custom_components.taylors3d.const import (
    DATA_PRESET_REQUESTS,
    DATA_PRESET_TARGETS,
    DOMAIN,
    EVENT_SELECT_VIEW,
    SERVICE_SELECT_VIEW,
    WS_PRESET_RESULT,
    WS_PRESET_SUBSCRIBE,
)

REQUEST = {"layout_key": "house", "preset": "Front door", "card_id": "wall-tablet"}


async def _setup(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {}})
    await hass.async_block_till_done()


async def _request(hass: HomeAssistant, hass_ws_client, data=None, return_response=False):
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "card_id": "wall-tablet"})
    assert (await client.receive_json())["success"]
    task = asyncio.create_task(hass.services.async_call(
        DOMAIN, SERVICE_SELECT_VIEW, data or REQUEST, blocking=True, return_response=return_response
    ))
    event = (await client.receive_json())["event"]
    return client, task, event["data"]


async def _reply(client, event, **extra):
    await client.send_json_auto_id({
        "type": WS_PRESET_RESULT,
        "request_id": event["request_id"],
        "target_id": event["target_id"],
        "layout_key": event["layout_key"],
        "card_id": "wall-tablet",
        "status": "selected",
        "view_id": "door",
        "mode": "3d",
        **extra,
    })
    return await client.receive_json()


async def test_registered_before_an_entry_has_loaded(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, DOMAIN, {})
    assert hass.services.has_service(DOMAIN, SERVICE_SELECT_VIEW)
    with pytest.raises(ServiceValidationError, match="Add the Taylor's 3D integration"):
        await hass.services.async_call(DOMAIN, SERVICE_SELECT_VIEW, REQUEST, blocking=True)
    assert hass.data[DATA_PRESET_REQUESTS] == {}


async def test_selects_an_acknowledged_preset_and_returns_optional_response(hass, hass_ws_client) -> None:
    await _setup(hass)
    client, task, event = await _request(hass, hass_ws_client, return_response=True)
    assert event.items() >= REQUEST.items()
    assert (await _reply(client, event))["success"]
    assert await task == {"layout_key": "house", "card_id": "wall-tablet", "view_id": "door", "mode": "3d"}
    assert hass.data[DATA_PRESET_REQUESTS] == {}


async def test_normal_action_needs_no_response_variable(hass, hass_ws_client) -> None:
    await _setup(hass)
    client, task, event = await _request(hass, hass_ws_client)
    assert (await _reply(client, event))["success"]
    assert await task is None


async def test_non_admin_panel_can_subscribe_and_confirm(hass, hass_ws_client, hass_read_only_access_token) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id({"type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "card_id": "wall-tablet"})
    assert (await client.receive_json())["success"]
    task = asyncio.create_task(hass.services.async_call(DOMAIN, SERVICE_SELECT_VIEW, REQUEST, blocking=True))
    event = (await client.receive_json())["event"]
    assert event["event_type"] == EVENT_SELECT_VIEW
    assert (await _reply(client, event["data"]))["success"]
    await task


@pytest.mark.parametrize("status", ["invalid_preset", "ambiguous_preset", "not_ready", "failed"])
async def test_card_errors_raise_action_errors(hass, hass_ws_client, status) -> None:
    await _setup(hass)
    client, task, event = await _request(hass, hass_ws_client)
    assert (await _reply(client, event, status=status, message="No matching camera"))["success"]
    with pytest.raises(ServiceValidationError, match="No matching camera"):
        await task
    assert hass.data[DATA_PRESET_REQUESTS] == {}


async def test_other_card_cannot_confirm_and_duplicate_reply_is_stale(hass, hass_ws_client) -> None:
    await _setup(hass)
    client, task, event = await _request(hass, hass_ws_client)
    assert (await _reply(client, event, card_id="phone"))["error"]["code"] == "wrong_target"
    assert not task.done()
    assert (await _reply(client, event))["success"]
    await task
    assert (await _reply(client, event))["error"]["code"] == "stale_request"


async def test_unavailable_card_errors_before_firing_an_event(hass) -> None:
    await _setup(hass)
    with pytest.raises(ServiceValidationError, match="No open"):
        await hass.services.async_call(DOMAIN, SERVICE_SELECT_VIEW, REQUEST, blocking=True)
    assert hass.data[DATA_PRESET_REQUESTS] == {}


async def test_unresponsive_registered_card_times_out_and_cleans_pending_request(hass, hass_ws_client, monkeypatch) -> None:
    await _setup(hass)
    monkeypatch.setattr(services, "PRESET_RESPONSE_TIMEOUT", 0.01)
    client, task, event = await _request(hass, hass_ws_client)
    with pytest.raises(ServiceValidationError, match="did not respond"):
        await task
    assert hass.data[DATA_PRESET_REQUESTS] == {}
    assert (await _reply(client, event))["error"]["code"] == "stale_request"


async def test_duplicate_address_is_rejected_before_camera_request(hass, hass_ws_client) -> None:
    await _setup(hass)
    for _ in range(2):
        client = await hass_ws_client(hass)
        await client.send_json_auto_id({"type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "card_id": "wall-tablet"})
        assert (await client.receive_json())["success"]
    with pytest.raises(ServiceValidationError, match="Several open"):
        await hass.services.async_call(DOMAIN, SERVICE_SELECT_VIEW, REQUEST, blocking=True)
    assert hass.data[DATA_PRESET_REQUESTS] == {}


async def test_unsubscribe_releases_address(hass, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "panel": "hallway"})
    message = await client.receive_json()
    assert message["success"]
    assert len(hass.data[DATA_PRESET_TARGETS]) == 1
    await client.send_json_auto_id({"type": "unsubscribe_events", "subscription": message["id"]})
    assert (await client.receive_json())["success"]
    assert not hass.data[DATA_PRESET_TARGETS]


async def test_panel_with_multiple_cards_requires_card_id(hass, hass_ws_client) -> None:
    await _setup(hass)
    clients = []
    for card_id in ("wall-tablet", "phone"):
        client = await hass_ws_client(hass)
        clients.append(client)
        await client.send_json_auto_id({"type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "panel": "hallway", "card_id": card_id})
        assert (await client.receive_json())["success"]
    with pytest.raises(ServiceValidationError, match="Several open"):
        await hass.services.async_call(DOMAIN, SERVICE_SELECT_VIEW, {"layout_key": "house", "preset": "Front door", "panel": "hallway"}, blocking=True)
    task = asyncio.create_task(hass.services.async_call(DOMAIN, SERVICE_SELECT_VIEW, {**REQUEST, "panel": "hallway"}, blocking=True))
    event = (await clients[0].receive_json())["event"]["data"]
    # Even a second logged-in card cannot impersonate the addressed connection.
    assert (await _reply(clients[1], event, panel="hallway"))["error"]["code"] == "wrong_target"
    assert (await _reply(clients[0], event, panel="hallway"))["success"]
    await task


async def test_selected_reply_requires_actual_view_and_mode(hass, hass_ws_client) -> None:
    await _setup(hass)
    client, task, event = await _request(hass, hass_ws_client)
    await client.send_json_auto_id({
        "type": WS_PRESET_RESULT, "request_id": event["request_id"], "layout_key": "house",
        "target_id": event["target_id"],
        "card_id": "wall-tablet", "status": "selected",
    })
    assert (await client.receive_json())["error"]["code"] == "invalid_result"
    assert (await _reply(client, event))["success"]
    await task


@pytest.mark.parametrize("bad", [
    {"layout_key": "house", "preset": "Front door"},
    {**REQUEST, "layout_key": ""},
    {**REQUEST, "preset": " "},
    {**REQUEST, "mode": "sideways"},
    {**REQUEST, "return_after": -1},
    {**REQUEST, "return_after": float("nan")},
    {**REQUEST, "return_after": float("inf")},
])
def test_request_schema_rejects_missing_target_and_bad_data(bad) -> None:
    with pytest.raises(vol.Invalid):
        services.SELECT_VIEW_SCHEMA(bad)


def test_schema_accepts_panel_only_and_optional_return() -> None:
    assert services.SELECT_VIEW_SCHEMA({
        "layout_key": "house", "preset": "Garden", "panel": "hallway", "return_after": 15,
    }) == {"layout_key": "house", "preset": "Garden", "panel": "hallway", "return_after": 15.0}


def test_subscription_schema_extends_home_assistant_command_id() -> None:
    """Exercise the installed core's actual decorator extension, not a copied schema."""
    message = {"id": 7, "type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "panel": "hallway"}
    assert services.ws_subscribe_presets._ws_schema(message) == message


@pytest.mark.parametrize("bad", [
    {"id": 7, "type": WS_PRESET_SUBSCRIBE, "layout_key": "house"},
    {"id": 7, "type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "panel": " "},
    {"type": WS_PRESET_SUBSCRIBE, "layout_key": "house", "card_id": "wall-tablet"},
])
def test_installed_subscription_schema_rejects_missing_address_and_command_id(bad) -> None:
    with pytest.raises(vol.Invalid):
        services.ws_subscribe_presets._ws_schema(bad)


def test_result_schema_extends_home_assistant_command_id() -> None:
    message = {
        "id": 8, "type": WS_PRESET_RESULT, "request_id": "request-1", "target_id": "target-1",
        "layout_key": "house", "card_id": "wall-tablet", "status": "selected", "view_id": "door", "mode": "3d",
    }
    assert services.ws_preset_result._ws_schema(message) == message
