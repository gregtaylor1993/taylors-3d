"""Config flow for Floorplan 3D: one entry, nothing to configure."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class Floorplan3dConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add the integration from the UI (or from `floorplan3d:` in YAML)."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="Floorplan 3D", data={})
        return self.async_show_form(step_id="user")

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Turn a `floorplan3d:` YAML entry into a config entry."""
        return self.async_create_entry(title="Floorplan 3D", data={})
