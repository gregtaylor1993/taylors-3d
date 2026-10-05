"""Constants for the Taylor's 3D integration."""

DOMAIN = "taylors3d"
STORAGE_KEY = "taylors3d.layouts"
STORAGE_VERSION = 1
SAVE_DELAY = 1  # seconds, coalesces bursts of edits into one write
MAX_LAYOUT_BYTES = 2_000_000  # a layout is a few kB; refuse anything absurd

CARD_FILENAME = "taylors3d-card.js"
CARD_URL_BASE = "/taylors3d_static"

MODEL_URL = "/api/taylors3d/model"
MODEL_DIR = "taylors3d/models"
MAX_MODEL_BYTES = 100 * 1024 * 1024

SERVICE_SELECT_VIEW = "select_view"
EVENT_SELECT_VIEW = "taylors3d_select_view"
WS_PRESET_RESULT = "taylors3d/preset/result"
WS_PRESET_SUBSCRIBE = "taylors3d/preset/subscribe"
DATA_PRESET_REQUESTS = "taylors3d_preset_requests"
DATA_PRESET_TARGETS = "taylors3d_preset_targets"
PRESET_RESPONSE_TIMEOUT = 10  # seconds to hear from the requested open dashboard
