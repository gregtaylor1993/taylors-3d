// Shared visual theme for both the House shell and the standard card layout.
// Importing this file alone does not inject CSS or create controls.
// No reference photos, household readings, assets, fonts or routes are embedded.

export const TAYLORS3D_THEME_PALETTES = Object.freeze({
  dark: Object.freeze({
    background: '#101012', surface: '#1c1c1e', raised: '#2b2b2e',
    text: '#f5f5f7', muted: '#c3c3c8', border: '#8e8e93', divider: '#424246',
    amber: '#ffc767', 'on-amber': '#362a15', 'amber-ink': '#ffd493', 'amber-soft': '#393123',
    // Existing components use these aliases; navigation is now monochrome.
    teal: '#f5f5f7', 'on-teal': '#171719', 'teal-ink': '#e5e5ea', 'teal-soft': '#333336',
    focus: '#f5f5f7', danger: '#ffb4a9',
    glass: '#1c1c1e', 'glass-translucent': 'rgb(28 28 30 / 90%)',
    shadow: '0 14px 40px rgb(0 0 0 / 24%), inset 0 1px 0 rgb(255 255 255 / 5%)',
  }),
  light: Object.freeze({
    background: '#f5f5f7', surface: '#ffffff', raised: '#ececee',
    text: '#1d1d1f', muted: '#57575e', border: '#72727a', divider: '#d1d1d6',
    amber: '#ffc767', 'on-amber': '#362a15', 'amber-ink': '#805100', 'amber-soft': '#fff0d1',
    teal: '#1d1d1f', 'on-teal': '#ffffff', 'teal-ink': '#1d1d1f', 'teal-soft': '#e3e3e7',
    focus: '#1d1d1f', danger: '#a32620',
    glass: '#ffffff', 'glass-translucent': 'rgb(255 255 255 / 92%)',
    shadow: '0 14px 40px rgb(0 0 0 / 10%), inset 0 1px 0 rgb(255 255 255 / 75%)',
  }),
});

const declarations = (palette) => Object.entries(palette).map(([key, value]) => `--taylors3d-ui-${key}:${value};`).join('\n');
const THEME_HOST = ':host(:is([data-taylors3d-theme="house"],[data-taylors3d-theme="glass"]))';
const SCHEME_HOST = (scheme) => `:host(:is([data-taylors3d-theme="house"],[data-taylors3d-theme="glass"])[data-taylors3d-scheme${scheme ? `="${scheme}"` : ''}])`;

/** Presentation contract (data/actions and geometry remain owned by their modules):
 * - Host data-taylors3d-theme="house"|"glass" enables styles; scheme="dark"|"light"
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
 *   marks supported light actions. Navigation uses monochrome selection. Tone is
 *   presentation, never evidence that a device is on or a reading is current.
 */
export const TAYLORS3D_THEME_CSS = `
${THEME_HOST} {
  ${declarations(TAYLORS3D_THEME_PALETTES.light)}
  --taylors3d-ui-background:var(--primary-background-color,#f5f5f7);
  --taylors3d-ui-surface:var(--ha-card-background,var(--card-background-color,#ffffff));
  --taylors3d-ui-raised:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#ececee)));
  --taylors3d-ui-text:var(--primary-text-color,#1d1d1f);
  --taylors3d-ui-muted:var(--secondary-text-color,#57575e);
  --taylors3d-ui-teal:var(--primary-text-color,#1d1d1f);
  --taylors3d-ui-on-teal:var(--ha-card-background,var(--card-background-color,#ffffff));
  --taylors3d-ui-teal-ink:var(--primary-text-color,#1d1d1f);
  --taylors3d-ui-teal-soft:var(--secondary-background-color,#ececee);
  --taylors3d-ui-focus:var(--primary-text-color,#1d1d1f);
  --taylors3d-ui-glass:var(--taylors3d-ui-surface);
  --taylors3d-ui-glass-translucent:color-mix(in srgb,var(--taylors3d-ui-surface) 92%,transparent);
  --taylors3d-ui-blur:none;
  --taylors3d-ui-danger:var(--error-color,var(--taylors3d-ui-ha-danger,#a32620));
  --taylors3d-ui-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --taylors3d-ui-card-radius:24px;
  font-family:var(--taylors3d-ui-font);
}
${SCHEME_HOST('dark')} {
  ${declarations(TAYLORS3D_THEME_PALETTES.dark)}
  color-scheme:dark;
}
${SCHEME_HOST('light')} {
  ${declarations(TAYLORS3D_THEME_PALETTES.light)}
  color-scheme:light;
}
${THEME_HOST} ha-card {
  container-name:taylors3d-house;
  background:var(--taylors3d-ui-background);
  color:var(--taylors3d-ui-text);
  border-radius:var(--taylors3d-ui-card-radius);
  border:1px solid var(--taylors3d-ui-divider);
  font-family:var(--taylors3d-ui-font);
  line-height:1.45;
}
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail],[data-taylors3d-summary]) {
  box-sizing:border-box;
  background:var(--taylors3d-ui-surface);
  color:var(--taylors3d-ui-text);
  border-color:var(--taylors3d-ui-divider);
  font-family:var(--taylors3d-ui-font);
}
${THEME_HOST} .toolbar {
  border-radius:20px;
  gap:8px;
  padding:8px;
  box-shadow:var(--taylors3d-ui-shadow);
}
/* Glass is restricted to floating controls; editing surfaces remain solid. */
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.fp-pickmenu,.taylors3d-minimap,[data-scene-preview-bar],[data-house-navigation],[data-custom-controls-placement="left"] .custom-controls-bars,[data-custom-controls-view] .custom-controls-toggle) {
  background:var(--taylors3d-ui-glass);
  border-color:var(--taylors3d-ui-divider);
  box-shadow:var(--taylors3d-ui-shadow);
  -webkit-backdrop-filter:var(--taylors3d-ui-blur);
  backdrop-filter:var(--taylors3d-ui-blur);
}
@supports (backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px)) {
  ${THEME_HOST}, ${SCHEME_HOST()} {
    --taylors3d-ui-glass:var(--taylors3d-ui-glass-translucent);
    --taylors3d-ui-blur:blur(14px) saturate(105%);
  }
}
${THEME_HOST} :is(.chips,.bubble-actions) { gap:8px; scroll-padding-inline:8px; }
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :is(button,select,input,textarea,summary,label.button) {
  box-sizing:border-box;
  min-height:44px;
  max-width:100%;
  color:var(--taylors3d-ui-text);
  font:inherit;
}
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :where(button:not(.fp-swatch),select,input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]),textarea,label.button) {
  background:var(--taylors3d-ui-raised);
  color:var(--taylors3d-ui-text);
  border:1px solid var(--taylors3d-ui-divider);
  border-radius:12px;
  padding:9px 12px;
}
${THEME_HOST} :is(.panel,.taylors3d-device-popup) :is(input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]),select,textarea) {
  border-color:var(--taylors3d-ui-border);
}
${THEME_HOST} :is(.toolbar,.panel,.taylors3d-device-popup,.fp-popup,[data-scene-preview-bar],[data-house-navigation],[data-custom-controls-view]) button {
  touch-action:manipulation;
}
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :is(button,input,select,textarea,summary,a):focus-visible {
  outline:3px solid var(--taylors3d-ui-focus);
  outline-offset:3px;
}
/* Keep the whole keyboard ring inside horizontally scrolling toolbar rows. */
${THEME_HOST} .toolbar :is(button,input,select,textarea,summary,a):focus-visible {
  outline-color:currentColor;
  outline-offset:-4px;
}
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) button {
  min-width:44px;
  cursor:pointer;
  transition:background-color 120ms ease,border-color 120ms ease;
}
${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.taylors3d-minimap,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :disabled {
  opacity:1;
  color:var(--taylors3d-ui-muted);
  border-style:dashed;
  cursor:default;
}
${THEME_HOST} .toolbar :is(button.on,button[aria-pressed="true"]),
${THEME_HOST} [data-taylors3d-nav-rail] :is(button[aria-pressed="true"],a[aria-current="page"]) {
  color:var(--taylors3d-ui-on-teal);
  background:var(--taylors3d-ui-teal);
  border-color:var(--taylors3d-ui-teal);
  font-weight:600;
}
${THEME_HOST} .taylors3d-device-popup button[data-action="toggle"][data-entity^="light."],
${THEME_HOST} [data-taylors3d-tone="light"] {
  color:var(--taylors3d-ui-amber-ink);
  background:var(--taylors3d-ui-amber-soft);
}
${THEME_HOST} .toolbar [data-taylors3d-tone="floor"][aria-pressed="true"] {
  color:var(--taylors3d-ui-on-teal);
  background:var(--taylors3d-ui-teal);
  border-color:var(--taylors3d-ui-teal);
}
${THEME_HOST} :is(.taylors3d-device-popup,.fp-popup) {
  border-radius:20px;
  padding:16px;
  font-size:14px;
  box-shadow:var(--taylors3d-ui-shadow);
  overscroll-behavior:contain;
  scroll-padding-block:16px;
}
${THEME_HOST} .t3d-popup-head {
  position:sticky;
  top:0;
  z-index:2;
  background:var(--taylors3d-ui-surface);
  padding-bottom:8px;
}
${THEME_HOST} .taylors3d-device-popup h3 { font-size:18px; line-height:1.3; font-weight:650; }
${THEME_HOST} .t3d-room-summary { margin:6px 0 0; color:var(--taylors3d-ui-muted); font-size:13px; line-height:1.4; overflow-wrap:anywhere; }
${THEME_HOST} :is(.t3d-entity-name,.fp-pop-title) { font-weight:600; overflow-wrap:anywhere; }
${THEME_HOST} .t3d-entity { border-color:var(--taylors3d-ui-divider); padding:14px 0; }
${THEME_HOST} :is(.t3d-entity-value,.t3d-entity-status,.t3d-popup-kind,.t3d-camera-help,.t3d-inline-reading,.t3d-inline-hint,.t3d-room-action-issue,.panel .hint,.panel .dim,.panel .sub,.panel label,.panel .foot,[data-taylors3d-summary-meta]) {
  color:var(--taylors3d-ui-muted);
  overflow-wrap:anywhere;
}
${THEME_HOST} :is(.t3d-entity-error,.panel .bad,.notice) { color:var(--taylors3d-ui-danger); }
${THEME_HOST} .t3d-entity-actions { gap:8px; }
${THEME_HOST} :is(.t3d-light-reading,.t3d-camera-status,.t3d-camera-title) { color:var(--taylors3d-ui-text); }
${THEME_HOST} .taylors3d-camera-feed { color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} :is(.t3d-brightness,.fp-pop-row.brightness) input[type="range"] {
  width:100%;
  min-width:0;
  min-height:44px;
  accent-color:var(--taylors3d-ui-amber);
}
${THEME_HOST} .t3d-swatches { gap:8px; }
${THEME_HOST} .t3d-swatches button[aria-pressed="true"] { outline:3px solid var(--taylors3d-ui-amber); outline-offset:-4px; }
${THEME_HOST} .t3d-swatch-dot { border:2px solid var(--taylors3d-ui-border); }
${THEME_HOST} .fp-switch { width:64px; min-width:64px; padding:6px; justify-content:flex-start; align-items:center; }
${THEME_HOST} .fp-switch span { width:22px; height:22px; flex:none; }
${THEME_HOST} .fp-switch.on { background:var(--taylors3d-ui-teal); }
${THEME_HOST} .fp-switch.on span { transform:translateX(26px); }
${THEME_HOST} .panel { font-size:14px; border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} .panel :is(section,[data-trk-editor],[data-tracking-calibration],[data-env-weather-editor],[data-security-editor],.cov-editor) { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel p { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel :is(.val,a,a:visited) { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel :is(h3,h4) { color:var(--taylors3d-ui-text); line-height:1.35; }
${THEME_HOST} .panel .tabs button { padding:8px; flex:1 0 96px; min-width:96px; font-size:12px; white-space:normal; overflow-wrap:normal; border-radius:0; background:transparent; }
${THEME_HOST} .panel .tabs button.on { color:var(--taylors3d-ui-teal-ink); background:var(--taylors3d-ui-teal-soft); border-bottom:3px solid var(--taylors3d-ui-teal); }
${THEME_HOST} .panel .sub { text-transform:none; letter-spacing:0; font-size:12px; font-weight:600; }
${THEME_HOST} .panel .pill.ok { color:var(--taylors3d-ui-teal-ink); background:var(--taylors3d-ui-teal-soft); }
${THEME_HOST} .panel :is(.pill.missing,.badge.warn) { color:var(--taylors3d-ui-amber-ink); background:var(--taylors3d-ui-amber-soft); }
${THEME_HOST} .panel :is(button,label.button).primary { color:var(--taylors3d-ui-on-teal); background:var(--taylors3d-ui-teal); border-color:var(--taylors3d-ui-teal); }
${THEME_HOST} [data-scene-preview-bar] { border-radius:16px; padding:12px; font-size:14px; }
${THEME_HOST} [data-scene-preview-bar] :is(.scene-preview-note,.scene-preview-reason,[data-scene-preview-status]) { color:var(--taylors3d-ui-muted); font-size:13px; }
${THEME_HOST} [data-scene-preview-bar] .scene-preview-row { border-radius:14px; padding:6px; border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} [data-scene-preview-bar] button[data-scene-action="preview"] {
  color:var(--taylors3d-ui-teal-ink); background:var(--taylors3d-ui-teal-soft);
}
${THEME_HOST} [data-scene-preview-bar] button[data-scene-action="activate"] { font-weight:600; }
${THEME_HOST} [data-scene-preview-bar] button[aria-pressed="true"] { border:2px solid var(--taylors3d-ui-teal); }
${THEME_HOST} .taylors3d-minimap { border-radius:16px; border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} .taylors3d-minimap .map-header { padding:8px; gap:8px; }
${THEME_HOST} .taylors3d-minimap .map-title { white-space:normal; font-size:12px; }
${THEME_HOST} .taylors3d-minimap :is(.map-close,.map-floor) { min-height:44px; }
${THEME_HOST} .taylors3d-minimap .map-close { min-width:44px; width:44px; height:44px; padding:4px; }
${THEME_HOST} .taylors3d-minimap .map-floor { min-width:0; padding-inline:4px; }
${THEME_HOST} .status-legend { background:var(--taylors3d-ui-surface); color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); border-radius:12px; }
${THEME_HOST} .fp-room-label { color:var(--taylors3d-ui-text); background:var(--taylors3d-ui-surface); opacity:1;
  padding:3px 8px; border:1px solid var(--taylors3d-ui-divider); border-radius:8px; max-width:160px; white-space:normal;
  overflow-wrap:anywhere; text-align:center; line-height:1.35; font-size:12px; }
${THEME_HOST} .fp-marker .fp-dot { box-sizing:border-box; width:44px; height:44px; --mdc-icon-size:22px; }
${THEME_HOST} .fp-val { color:var(--taylors3d-ui-text); background:var(--taylors3d-ui-surface); }

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
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] .taylors3d-device-popup[data-taylors3d-controls="adaptive"][data-house-controls-layout="right"] { left:auto; right:8px; top:calc(var(--taylors3d-summary-height,0px) + 8px); bottom:calc(var(--taylors3d-bar-height,0px) + var(--taylors3d-navigation-height,0px) + 8px); width:min(316px,40%); max-width:none; max-height:var(--taylors3d-popup-available-height,100%); }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell="adaptive"] .taylors3d-device-popup[data-taylors3d-controls="adaptive"][data-house-controls-layout="sheet"] { left:8px; right:8px; top:auto; bottom:calc(var(--taylors3d-bar-height,0px) + var(--taylors3d-navigation-height,0px) + 8px); width:auto; max-width:none; max-height:min(var(--taylors3d-room-sheet-height,320px),var(--taylors3d-popup-available-height,100%)); border-radius:22px 22px 16px 16px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-mode="editor"] .taylors3d-device-popup[data-taylors3d-controls="adaptive"],
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-mode="hidden"] :is([data-house-navigation],[data-taylors3d-summary]) { display:none; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-size="compact"] :is(.toolbar,.panel) { border-radius:18px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-size="compact"] [data-taylors3d-summary] { padding:14px; }
:host([data-taylors3d-theme="house"]) .stage[data-taylors3d-shell-size="compact"] [data-taylors3d-summary-title] { font-size:20px; }
@media (prefers-reduced-motion:reduce) {
  ${THEME_HOST} :is(.toolbar,.taylors3d-device-popup,.fp-popup,.panel,[data-scene-preview-bar],[data-taylors3d-nav-rail]) :is(button,input,select) { transition:none; }
  ${THEME_HOST} :is(.fp-switch span,.fp-dot) { transition:none; }
  ${THEME_HOST} .fp-marker:hover .fp-dot { transform:none; }
}
@media (forced-colors:active) {
  ${THEME_HOST},
  ${SCHEME_HOST()} {
    --taylors3d-ui-background:Canvas; --taylors3d-ui-surface:Canvas; --taylors3d-ui-raised:Canvas;
    --taylors3d-ui-text:CanvasText; --taylors3d-ui-muted:CanvasText; --taylors3d-ui-border:CanvasText; --taylors3d-ui-divider:CanvasText;
    --taylors3d-ui-amber:Highlight; --taylors3d-ui-on-amber:HighlightText; --taylors3d-ui-amber-ink:CanvasText; --taylors3d-ui-amber-soft:Canvas;
    --taylors3d-ui-teal:Highlight; --taylors3d-ui-on-teal:HighlightText; --taylors3d-ui-teal-ink:CanvasText; --taylors3d-ui-teal-soft:Canvas;
    --taylors3d-ui-focus:Highlight; --taylors3d-ui-danger:CanvasText;
    --taylors3d-ui-glass:Canvas; --taylors3d-ui-glass-translucent:Canvas; --taylors3d-ui-blur:none; --taylors3d-ui-shadow:none;
    forced-color-adjust:auto;
  }
}
${THEME_HOST} .panel .editor-nav { border-color:var(--taylors3d-ui-divider); padding:12px; }
${THEME_HOST} .panel .editor-groups button { border-radius:12px; color:var(--taylors3d-ui-muted); background:var(--taylors3d-ui-surface); border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} .panel .editor-groups button[aria-pressed="true"] { color:var(--taylors3d-ui-on-teal); background:var(--taylors3d-ui-teal); border-color:var(--taylors3d-ui-teal); }
${THEME_HOST} .panel .editor-nav :is(h3,summary),
${THEME_HOST} .panel .editor-setup :is(h3,a) { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel .editor-setup-steps button { border-radius:12px; background:var(--taylors3d-ui-raised); color:var(--taylors3d-ui-muted); border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} .panel .editor-setup-steps button[aria-current="step"] { color:var(--taylors3d-ui-teal-ink); border-color:var(--taylors3d-ui-teal); background:var(--taylors3d-ui-teal-soft); }
${THEME_HOST} .panel .editor-setup .step-number { background:var(--taylors3d-ui-surface); color:var(--taylors3d-ui-text); }
${THEME_HOST} :is(.panel,.taylors3d-device-popup) :is(input,select,button,a,summary):focus-visible { outline:3px solid var(--taylors3d-ui-focus); outline-offset:2px; }
${THEME_HOST} :is(.toolbar,.panel,.taylors3d-device-popup) button { transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease; }
${THEME_HOST} .taylors3d-device-popup { box-shadow:var(--taylors3d-ui-shadow); }
${THEME_HOST} .toolbar :is(button.chip,.seg button) { border-radius:999px; line-height:1.2; }
${THEME_HOST} .toolbar .seg { gap:4px; padding:3px; border:1px solid var(--taylors3d-ui-divider); border-radius:999px; background:var(--taylors3d-ui-surface); }
${THEME_HOST} :is(.toolbar,[data-house-navigation]) button:not(:disabled):hover { border-color:var(--taylors3d-ui-border); }
${THEME_HOST} [data-house-navigation] button { background:transparent; border-color:transparent; border-radius:14px; }
${THEME_HOST} [data-house-navigation][data-taylors3d-nav-rail][data-house-navigation-layout],
${THEME_HOST} [data-custom-controls-view][data-custom-controls-placement="left"] .custom-controls-bars { background:var(--taylors3d-ui-glass); border-color:var(--taylors3d-ui-divider); box-shadow:var(--taylors3d-ui-shadow); }
${THEME_HOST} [data-house-navigation] button[aria-pressed="true"] { color:var(--taylors3d-ui-on-teal); background:var(--taylors3d-ui-teal); border-color:var(--taylors3d-ui-teal); }
${THEME_HOST} [data-taylors3d-summary] { background:transparent; }
${THEME_HOST} [data-taylors3d-summary-item] { background:var(--taylors3d-ui-surface); }
${THEME_HOST} .panel { background:var(--taylors3d-ui-surface); }
${THEME_HOST} .panel :is(.box,.editor-leave-review,.editor-setup,.editor-advanced,.advanced,.report) { border-color:var(--taylors3d-ui-divider); border-radius:14px; }
${THEME_HOST} .panel :is(.box,.editor-leave-review,.editor-setup) { padding:12px; }
${THEME_HOST} .panel .editor-leave-review { color:var(--taylors3d-ui-text); background:var(--taylors3d-ui-raised); }
${THEME_HOST} .panel .editor-nav-heading :is(h3,.editor-group-picker) { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel .editor-setup button:disabled { color:var(--taylors3d-ui-muted); }
${THEME_HOST} .panel :is(.editor-nav,.editor-advanced) :is(button,summary):focus-visible,
${THEME_HOST} .panel :is(.editor-setup,.editor-leave-review) :is(button,a):focus-visible,
${THEME_HOST} .panel [data-setup-upload]:focus-visible { outline-color:var(--taylors3d-ui-focus); }
${THEME_HOST} .panel :is(.foot,.tabs) { border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} .panel :is(label.check,table.floors th) { color:var(--taylors3d-ui-muted); }
${THEME_HOST} .panel :is(input[type="range"],input[type="checkbox"],input[type="radio"]) { accent-color:var(--taylors3d-ui-teal); }
${THEME_HOST} .panel :is(.editor-nav,.editor-advanced) .tabs button.on { background:var(--taylors3d-ui-teal-soft); color:var(--taylors3d-ui-teal-ink); border-bottom-color:var(--taylors3d-ui-teal); }
${THEME_HOST} .panel :is(button.danger,.bad,.msg.error) { color:var(--taylors3d-ui-danger); }
${THEME_HOST} .panel :is(.note.warn,.msg.warn) { color:var(--taylors3d-ui-amber-ink); background:var(--taylors3d-ui-amber-soft); }
${THEME_HOST} .panel :is(.note.ok,.msg:not(.warn):not(.error)) { background:var(--taylors3d-ui-teal-soft); }
${THEME_HOST} .panel :is(.list li.sel .name,.otree .sel,.vtree .picked) { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel tr.sel td { background:var(--taylors3d-ui-teal-soft); }
${THEME_HOST} .panel [data-custom-controls-editor][data-taylors3d-ui] .cc-actions>button[type="button"][data-act="custom-controls-save"] { color:var(--taylors3d-ui-on-teal); background:var(--taylors3d-ui-teal); border-color:var(--taylors3d-ui-teal); }
${THEME_HOST} .panel [data-custom-controls-editor] :is([data-cc-dragging],[data-cc-drop]) { outline-color:var(--taylors3d-ui-focus); }
${THEME_HOST} .panel [data-custom-controls-editor] input[type="checkbox"] { accent-color:var(--taylors3d-ui-teal); }
${THEME_HOST} .panel .imported-source-controls { color:var(--taylors3d-ui-text); }
${THEME_HOST} .panel .imported-source-controls p { color:var(--taylors3d-ui-muted); }
${THEME_HOST} .panel .imported-source-controls :is(button,input,select,summary) { color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-border); }
${THEME_HOST} .panel .imported-source-controls :is(button,input,select) { background:var(--taylors3d-ui-raised); }
${THEME_HOST} .panel .imported-source-controls :is(button,summary,input):focus-visible { outline-color:var(--taylors3d-ui-focus); }
${THEME_HOST} [data-custom-controls-view] :is(.custom-controls-heading,.custom-controls-status) { color:var(--taylors3d-ui-muted); }
${THEME_HOST} [data-custom-controls-view][data-taylors3d-ui] .custom-controls-item>button[data-custom-controls-button-id][data-color="theme"] { background:var(--taylors3d-ui-raised); color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} [data-custom-controls-view] :is(.custom-controls-more,.custom-controls-toggle) { border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} [data-custom-controls-view] :is(button[data-custom-controls-button-id],.custom-controls-more,.custom-controls-toggle):focus-visible { outline:3px solid var(--taylors3d-ui-focus); outline-offset:3px; }
${THEME_HOST} [data-ui-feedback] .ui-feedback-row { background:var(--taylors3d-ui-surface); border-color:var(--taylors3d-ui-divider); border-radius:14px; }
${THEME_HOST} .fp-pickmenu { color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); border-radius:14px; }
${THEME_HOST} .fp-pickmenu button { min-height:44px; color:var(--taylors3d-ui-text); }
${THEME_HOST} .fp-marker:not(.light):not(.active) .fp-dot { background:var(--taylors3d-ui-surface); color:var(--taylors3d-ui-text); border-color:var(--taylors3d-ui-divider); }
${THEME_HOST} .fp-marker.selected .fp-dot { outline-color:var(--taylors3d-ui-focus); }
${THEME_HOST} .taylors3d-minimap .map-room { fill:var(--taylors3d-ui-raised); stroke:var(--taylors3d-ui-muted); }
${THEME_HOST} .taylors3d-minimap .map-room:is(.selected,:hover) { fill:var(--taylors3d-ui-teal-soft); stroke:var(--taylors3d-ui-focus); }
${THEME_HOST} .taylors3d-minimap .map-north { fill:var(--taylors3d-ui-muted); }
${THEME_HOST} .taylors3d-minimap :is(button,select,[role="button"]):focus-visible { outline-color:var(--taylors3d-ui-focus); }
@media (prefers-reduced-transparency:reduce) {
  ${THEME_HOST}, ${SCHEME_HOST()} { --taylors3d-ui-glass:var(--taylors3d-ui-surface); --taylors3d-ui-blur:none; --taylors3d-ui-shadow:none; }
}
@media (prefers-reduced-motion:reduce) {
  ${THEME_HOST} :is(.toolbar,.panel,.taylors3d-device-popup) button { transition:none; }
}
${THEME_HOST} [hidden] { display:none !important; }
`;
