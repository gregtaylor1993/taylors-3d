"""Config flow for Taylor's 3D: one entry, nothing to configure."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class Taylors3dConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add the integration from the UI (or from `taylors3d:` in YAML)."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="Taylor's 3D", data={})
        return self.async_show_form(step_id="user")

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Turn a `taylors3d:` YAML entry into a config entry."""
        return self.async_create_entry(title="Taylor's 3D", data={})
