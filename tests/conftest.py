"""Fixtures for the taylors3d integration tests."""

import pytest


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load integrations from custom_components/."""
    yield
