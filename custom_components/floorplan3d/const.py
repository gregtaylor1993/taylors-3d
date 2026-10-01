"""Constants for the Floorplan 3D integration."""

DOMAIN = "floorplan3d"
STORAGE_KEY = "floorplan3d.layouts"
STORAGE_VERSION = 1
SAVE_DELAY = 1  # seconds, coalesces bursts of edits into one write
MAX_LAYOUT_BYTES = 2_000_000  # a layout is a few kB; refuse anything absurd

CARD_FILENAME = "floorplan3d-card.js"
CARD_URL_BASE = "/floorplan3d_static"

MODEL_URL = "/api/floorplan3d/model"
MODEL_DIR = "floorplan3d/models"
MAX_MODEL_BYTES = 100 * 1024 * 1024
