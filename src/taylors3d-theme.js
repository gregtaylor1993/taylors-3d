// HouseShell activates this stylesheet only for the chosen House layout.
// Importing this file alone does not inject CSS or create controls.
// No reference photos, household readings, assets, fonts or routes are embedded.

export const TAYLORS3D_THEME_PALETTES = Object.freeze({
  dark: Object.freeze({
    background: '#131a21', surface: '#1d2731', raised: '#253340',
    text: '#f2f5f7', muted: '#bcc7cf', border: '#8796a3', divider: '#354450',
    amber: '#ffc767', 'on-amber': '#362a15', 'amber-ink': '#ffd493', 'amber-soft': '#393123',
    teal: '#51d4c4', 'on-teal': '#0c3431', 'teal-ink': '#87e6d9', 'teal-soft': '#173a38',
    focus: '#51d4c4', danger: '#ffb4a9',
  }),
  light: Object.freeze({
    background: '#eef2f5', surface: '#ffffff', raised: '#e8eef2',
    text: '#1c2a35', muted: '#4b5e6b', border: '#677c8b', divider: '#d1dbe1',
    amber: '#ffc767', 'on-amber': '#362a15', 'amber-ink': '#805100', 'amber-soft': '#fff0d1',
    teal: '#007a70', 'on-teal': '#ffffff', 'teal-ink': '#00665e', 'teal-soft': '#d9f1ed',
    focus: '#007a70', danger: '#a32620',
  }),
});

const declarations = (palette) => Object.entries(palette).map(([key, value]) => `--taylors3d-ui-${key}:${value};`).join('\n');

/** CSS contract for a later, separately verified polish checkpoint:
 * - Host data-taylors3d-theme="house" enables styles; scheme="dark"|"light"
 *   selects a paired palette. With no scheme, existing HA theme colours apply.
 * - Existing toolbar/dialog/editor/camera/scene/minimap classes are supported.
 *   Their data/actions, hidden/disabled flags, role/aria, focus and listeners are
 *   untouched. Native HA cards retain their own shadow styles and permissions.
 * - OPTIONAL stage data-taylors3d-shell="adaptive" needs measured HouseShell
 *   integration BEFORE activation. Actual stage width sets shell-mode and
 *   compact/comfortable shell-size, independently of browser width.
 * - HouseShell supplies measured summary, rail, navigation, toolbar, sheet and
 *   controls reserves. Root uses that exact scene rectangle before View.resize.
 * - OPTIONAL popup data-taylors3d-controls="adaptive" clears old inline pointer
 *   positions only while owned. A right panel/sheet attribute selects actual
 *   positioning above both bottom control rows. No CSS-only gesture,
 *   focus trap, drag handle or navigation action is invented here.
 * - OPTIONAL data-taylors3d-summary/title/meta/item markup accepts ONLY root's
 *   real configured title and current readings, with explicit missing labels.
 * - data-taylors3d-tone="floor" marks real floor/layer choices; tone="light"
 *   marks supported light actions. Other navigation remains teal. Tone is
 *   presentation, never evidence that a device is on or a reading is current.
 */
export const TAYLORS3D_THEME_CSS = `
:host([data-taylors3d-theme="house"]) {
  ${declarations(TAYLORS3D_THEME_PALETTES.light)}
  --taylors3d-ui-background:var(--primary-background-color,#eef2f5);
  --taylors3d-ui-surface:var(--ha-card-background,var(--card-background-color,#ffffff));
  --taylors3d-ui-raised:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#e8eef2)));
  --taylors3d-ui-text:var(--primary-text-color,#1c2a35);
  --taylors3d-ui-muted:var(--secondary-text-color,#4b5e6b);
  --taylors3d-ui-danger:var(--error-color,#a32620);
  --taylors3d-ui-font:var(--paper-font-body1_-_font-family,inherit);
  --taylors3d-ui-card-radius:24px;
  font-family:var(--taylors3d-ui-font);
}
:host([data-taylors3d-theme="house"][data-taylors3d-scheme="dark"]) {
  ${declarations(TAYLORS3D_THEME_PALETTES.dark)}
  color-scheme:dark;
}
:host([data-taylors3d-theme="house"][data-taylors3d-scheme="light"]) {
  ${declarations(TAYLORS3D_THEME_PALETTES.light)}
  color-scheme:light;
}
:host([data-taylors3d-theme="house"]) ha-card {
  container-name:taylors3d-house;
  background:var(--taylors3d-ui-background);
  color:var(--taylors3d-ui-text);
  border-radius:var(--taylors3d-ui-card-radius);
  border:1px solid var(--taylors3d-ui-divider);
  font-family:var(--taylors3d-ui-font);
  line-height:1.45;
}
:host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail],[data-taylors3d-summary]) {
  box-sizing:border-box;
  background:var(--taylors3d-ui-surface);
  color:var(--taylors3d-ui-text);
  border-color:var(--taylors3d-ui-divider);
  font-family:var(--taylors3d-ui-font);
}
:host([data-taylors3d-theme="house"]) .toolbar {
  border-radius:20px;
  gap:8px;
  padding:8px;
  box-shadow:0 4px 18px rgb(0 0 0 / 14%);
}
:host([data-taylors3d-theme="house"]) :is(.chips,.bubble-actions) { gap:8px; scroll-padding-inline:8px; }
:host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :is(button,select,input,textarea,summary,label.button) {
  box-sizing:border-box;
  min-height:44px;
  max-width:100%;
  color:var(--taylors3d-ui-text);
  font:inherit;
}
:host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :where(button:not(.fp-swatch),select,input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]),textarea,label.button) {
  background:var(--taylors3d-ui-raised);
  color:var(--taylors3d-ui-text);
  border:1px solid var(--taylors3d-ui-border);
  border-radius:12px;
  padding:9px 12px;
}
:host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :is(button,input,select,textarea,summary,a):focus-visible {
  outline:3px solid var(--taylors3d-ui-focus);
  outline-offset:3px;
}
:host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) button {
  min-width:44px;
  cursor:pointer;
  transition:background-color 120ms ease,border-color 120ms ease;
}
:host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :disabled {
  opacity:.6;
  cursor:default;
}
:host([data-taylors3d-theme="house"]) .toolbar :is(button.on,button[aria-pressed="true"]),
:host([data-taylors3d-theme="house"]) [data-taylors3d-nav-rail] :is(button[aria-pressed="true"],a[aria-current="page"]) {
  color:var(--taylors3d-ui-on-teal);
  background:var(--taylors3d-ui-teal);
  border-color:var(--taylors3d-ui-teal);
  font-weight:600;
}
:host([data-taylors3d-theme="house"]) .toolbar [data-taylors3d-tone="floor"],
:host([data-taylors3d-theme="house"]) .taylors3d-device-popup button[data-action="toggle"][data-entity^="light."],
:host([data-taylors3d-theme="house"]) [data-taylors3d-tone="light"] {
  color:var(--taylors3d-ui-amber-ink);
  background:var(--taylors3d-ui-amber-soft);
}
:host([data-taylors3d-theme="house"]) .toolbar [data-taylors3d-tone="floor"][aria-pressed="true"] {
  color:var(--taylors3d-ui-on-amber);
  background:var(--taylors3d-ui-amber);
  border-color:var(--taylors3d-ui-amber);
}
:host([data-taylors3d-theme="house"]) :is(.taylors3d-device-popup,.fp-popup) {
  border-radius:20px;
  padding:16px;
  font-size:14px;
  box-shadow:0 8px 28px rgb(0 0 0 / 18%);
  overscroll-behavior:contain;
  scroll-padding-block:16px;
}
:host([data-taylors3d-theme="house"]) .t3d-popup-head {
  position:sticky;
  top:0;
  z-index:2;
  background:var(--taylors3d-ui-surface);
  padding-bottom:8px;
  border-bottom:1px solid var(--taylors3d-ui-divider);
}
:host([data-taylors3d-theme="house"]) .taylors3d-device-popup h3 { font-size:18px; line-height:1.3; font-weight:650; }
:host([data-taylors3d-theme="house"]) .t3d-room-summary { margin:6px 0 0; color:var(--taylors3d-ui-muted); font-size:13px; line-height:1.4; overflow-wrap:anywhere; }
:host([data-taylors3d-theme="house"]) :is(.t3d-entity-name,.fp-pop-title) { font-weight:600; overflow-wrap:anywhere; }
:host([data-taylors3d-theme="house"]) .t3d-entity { border-color:var(--taylors3d-ui-divider); padding:14px 0; }
:host([data-taylors3d-theme="house"]) :is(.t3d-entity-value,.t3d-entity-status,.t3d-popup-kind,.t3d-camera-help,.panel .hint,.panel .dim,.panel label,.panel .foot,[data-taylors3d-summary-meta]) {
  color:var(--taylors3d-ui-muted);
  overflow-wrap:anywhere;
}
:host([data-taylors3d-theme="house"]) :is(.t3d-entity-error,.panel .bad,.notice) { color:var(--taylors3d-ui-danger); }
:host([data-taylors3d-theme="house"]) .t3d-entity-actions { gap:8px; }
:host([data-taylors3d-theme="house"]) :is(.t3d-light-reading,.t3d-camera-status,.t3d-camera-title) { color:var(--taylors3d-ui-text); }
:host([data-taylors3d-theme="house"]) .taylors3d-camera-feed { color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); }
:host([data-taylors3d-theme="house"]) :is(.t3d-brightness,.fp-pop-row.brightness) input[type="range"] {
  width:100%;
  min-width:0;
  min-height:44px;
  accent-color:var(--taylors3d-ui-amber);
}
:host([data-taylors3d-theme="house"]) .t3d-swatches { gap:8px; }
:host([data-taylors3d-theme="house"]) .t3d-swatches button[aria-pressed="true"] { outline:3px solid var(--taylors3d-ui-amber); outline-offset:-4px; }
:host([data-taylors3d-theme="house"]) .t3d-swatch-dot { border:2px solid var(--taylors3d-ui-border); }
:host([data-taylors3d-theme="house"]) .fp-switch { width:64px; min-width:64px; padding:6px; justify-content:flex-start; align-items:center; }
:host([data-taylors3d-theme="house"]) .fp-switch span { width:22px; height:22px; flex:none; }
:host([data-taylors3d-theme="house"]) .fp-switch.on { background:var(--taylors3d-ui-teal); }
:host([data-taylors3d-theme="house"]) .fp-switch.on span { transform:translateX(26px); }
:host([data-taylors3d-theme="house"]) .panel { font-size:14px; border-color:var(--taylors3d-ui-divider); }
:host([data-taylors3d-theme="house"]) .panel :is(section,[data-trk-editor],[data-tracking-calibration],[data-env-weather-editor],[data-security-editor],.cov-editor) { color:var(--taylors3d-ui-text); }
:host([data-taylors3d-theme="house"]) .panel p { color:var(--taylors3d-ui-text); }
:host([data-taylors3d-theme="house"]) .panel :is(h3,h4) { color:var(--taylors3d-ui-text); line-height:1.35; }
:host([data-taylors3d-theme="house"]) .panel .tabs button { padding:8px; flex:1 0 96px; min-width:96px; font-size:12px; white-space:normal; overflow-wrap:normal; border-radius:0; background:transparent; }
:host([data-taylors3d-theme="house"]) .panel .tabs button.on { color:var(--taylors3d-ui-teal-ink); border-bottom:3px solid var(--taylors3d-ui-teal); }
:host([data-taylors3d-theme="house"]) .panel button.primary { color:var(--taylors3d-ui-on-teal); background:var(--taylors3d-ui-teal); border-color:var(--taylors3d-ui-teal); }
:host([data-taylors3d-theme="house"]) [data-scene-preview-bar] { border-radius:16px; padding:12px; font-size:14px; }
:host([data-taylors3d-theme="house"]) [data-scene-preview-bar] :is(.scene-preview-note,.scene-preview-reason,[data-scene-preview-status]) { color:var(--taylors3d-ui-muted); font-size:13px; }
:host([data-taylors3d-theme="house"]) [data-scene-preview-bar] .scene-preview-row { border-radius:14px; padding:6px; border-color:var(--taylors3d-ui-divider); }
:host([data-taylors3d-theme="house"]) [data-scene-preview-bar] button[data-scene-action="preview"] {
  color:var(--taylors3d-ui-teal-ink); background:var(--taylors3d-ui-teal-soft);
}
:host([data-taylors3d-theme="house"]) [data-scene-preview-bar] button[data-scene-action="activate"] { font-weight:600; }
:host([data-taylors3d-theme="house"]) [data-scene-preview-bar] button[aria-pressed="true"] { border:2px solid var(--taylors3d-ui-teal); }
:host([data-taylors3d-theme="house"]) .taylors3d-minimap { border-radius:16px; border-color:var(--taylors3d-ui-divider); }
:host([data-taylors3d-theme="house"]) .taylors3d-minimap .map-header { padding:8px; gap:8px; }
:host([data-taylors3d-theme="house"]) .taylors3d-minimap .map-title { white-space:normal; font-size:12px; }
:host([data-taylors3d-theme="house"]) .taylors3d-minimap :is(.map-close,.map-floor) { min-height:44px; }
:host([data-taylors3d-theme="house"]) .taylors3d-minimap .map-close { min-width:44px; width:44px; height:44px; padding:4px; }
:host([data-taylors3d-theme="house"]) .taylors3d-minimap .map-floor { min-width:0; padding-inline:4px; }
:host([data-taylors3d-theme="house"]) .status-legend { background:var(--taylors3d-ui-surface); color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); border-radius:12px; }
:host([data-taylors3d-theme="house"]) .fp-room-label { color:var(--taylors3d-ui-muted); }
:host([data-taylors3d-theme="house"]) .fp-val { color:var(--taylors3d-ui-text); background:var(--taylors3d-ui-surface); }

/* Measured shell hooks. Root must reserve the actual scene rectangle. */
:host([data-taylors3d-theme="house"]) [data-taylors3d-summary] {
  padding:18px 20px;
  min-width:0;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}
:host([data-taylors3d-theme="house"]) [data-taylors3d-summary-title] { margin:0; font-size:22px; font-weight:650; line-height:1.2; overflow-wrap:anywhere; }
:host([data-taylors3d-theme="house"]) [data-taylors3d-summary-meta] { margin:5px 0 0; font-size:13px; }
:host([data-taylors3d-theme="house"]) [data-taylors3d-summary-items] { display:flex; flex-wrap:wrap; gap:8px; min-width:0; }
:host([data-taylors3d-theme="house"]) [data-taylors3d-summary-item] { max-width:100%; border:1px solid var(--taylors3d-ui-divider); border-radius:999px; padding:8px 12px; overflow-wrap:anywhere; font-size:13px; }
:host([data-taylors3d-theme="house"]) [data-taylors3d-nav-rail] { display:none; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] .scene { top:var(--taylors3d-summary-height,0px); left:var(--taylors3d-rail-width,0px); right:var(--taylors3d-controls-width,0px); bottom:calc(var(--taylors3d-bar-height,0px) + var(--taylors3d-navigation-height,0px) + var(--taylors3d-sheet-height,0px)); z-index:0; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] [data-taylors3d-summary] { position:absolute; inset:0 0 auto 0; z-index:20; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] .toolbar { left:calc(var(--taylors3d-rail-width,0px) + 8px); right:calc(var(--taylors3d-controls-width,0px) + 8px); bottom:calc(var(--taylors3d-navigation-height,0px) + 8px); }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] :is(.notice,.status-legend) { left:calc(var(--taylors3d-rail-width,0px) + 8px); right:calc(var(--taylors3d-controls-width,0px) + 8px); bottom:calc(var(--taylors3d-bar-height,0px) + var(--taylors3d-navigation-height,0px) + var(--taylors3d-sheet-height,0px) + 8px); max-width:calc(100% - var(--taylors3d-rail-width,0px) - var(--taylors3d-controls-width,0px) - 16px); }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] [data-house-navigation] { display:block; position:absolute; z-index:20; left:8px; right:8px; bottom:8px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-mode="rail"] [data-house-navigation] { top:calc(var(--taylors3d-summary-height,0px) + 8px); right:auto; width:calc(var(--taylors3d-rail-width,88px) - 16px); max-height:calc(100% - var(--taylors3d-summary-height,0px) - 16px); overflow-y:auto; padding:4px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-mode="rail"] [data-house-navigation] button { padding:8px 3px; min-height:64px; font-size:12px; line-height:1.3; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] .taylors3d-device-popup[data-taylors3d-controls="adaptive"][data-house-controls-layout="right"] { left:auto; right:8px; top:calc(var(--taylors3d-summary-height,0px) + 8px); bottom:calc(var(--taylors3d-bar-height,0px) + var(--taylors3d-navigation-height,0px) + 8px); width:min(316px,40%); max-width:none; max-height:none; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] .taylors3d-device-popup[data-taylors3d-controls="adaptive"][data-house-controls-layout="sheet"] { left:8px; right:8px; top:auto; bottom:calc(var(--taylors3d-bar-height,0px) + var(--taylors3d-navigation-height,0px) + 8px); width:auto; max-width:none; max-height:320px; border-radius:22px 22px 16px 16px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-mode="editor"] .taylors3d-device-popup[data-taylors3d-controls="adaptive"],
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-mode="hidden"] :is([data-house-navigation],[data-taylors3d-summary]) { display:none; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-size="compact"] :is(.toolbar,.panel) { border-radius:18px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-size="compact"] [data-taylors3d-summary] { padding:14px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-size="compact"] [data-taylors3d-summary-title] { font-size:20px; }
@media (prefers-reduced-motion:reduce) {
  :host([data-taylors3d-theme="house"]) :is(.toolbar,.taylors3d-device-popup,.fp-popup,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :is(button,input,select) { transition:none; }
  :host([data-taylors3d-theme="house"]) :is(.fp-switch span,.fp-dot) { transition:none; }
  :host([data-taylors3d-theme="house"]) .fp-marker:hover .fp-dot { transform:none; }
}
@media (forced-colors:active) {
  :host([data-taylors3d-theme="house"]),
  :host([data-taylors3d-theme="house"][data-taylors3d-scheme]) {
    --taylors3d-ui-background:Canvas; --taylors3d-ui-surface:Canvas; --taylors3d-ui-raised:Canvas;
    --taylors3d-ui-text:CanvasText; --taylors3d-ui-muted:CanvasText; --taylors3d-ui-border:CanvasText; --taylors3d-ui-divider:CanvasText;
    --taylors3d-ui-amber:Highlight; --taylors3d-ui-on-amber:HighlightText; --taylors3d-ui-amber-ink:CanvasText; --taylors3d-ui-amber-soft:Canvas;
    --taylors3d-ui-teal:Highlight; --taylors3d-ui-on-teal:HighlightText; --taylors3d-ui-teal-ink:CanvasText; --taylors3d-ui-teal-soft:Canvas;
    --taylors3d-ui-focus:Highlight; --taylors3d-ui-danger:CanvasText;
    forced-color-adjust:auto;
  }
}
:host([data-taylors3d-theme="house"]) [hidden] { display:none !important; }
`;
