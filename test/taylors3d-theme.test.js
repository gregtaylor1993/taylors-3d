import { describe, expect, it } from 'vitest';
import { parse, walk, generate } from 'css-tree';
import { TAYLORS3D_THEME_CSS, TAYLORS3D_THEME_PALETTES } from '../src/taylors3d-theme.js';

// These tests certify the supplied paired palette and stylesheet isolation.
// They do not claim browser geometry, native range colours, or arbitrary user
// theme overrides have been measured; those need the later polish browser pass.
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

describe.each(Object.entries(TAYLORS3D_THEME_PALETTES))('%s house palette', (_name, palette) => {
  const textPairs = [
    ...['background', 'surface', 'raised'].flatMap((background) => [['text', background], ['muted', background]]),
    ['on-amber', 'amber'], ['amber-ink', 'amber-soft'], ['amber-ink', 'surface'],
    ['on-teal', 'teal'], ['teal-ink', 'teal-soft'], ['teal-ink', 'surface'], ['danger', 'surface'],
  ];
  it.each(textPairs)('keeps normal %s text on %s at WCAG AA contrast', (foreground, background) => {
    expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['background', 'surface', 'raised'])('keeps focus and control boundaries identifiable on %s', (background) => {
    expect(contrast(palette.focus, palette[background])).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.border, palette[background])).toBeGreaterThanOrEqual(3);
  });
});

describe('opt-in theme stylesheet', () => {
  it('parses completely and scopes every style to the one opted-in card host', () => {
    const errors = [], tree = parse(TAYLORS3D_THEME_CSS, { onParseError: (error) => errors.push(error) });
    expect(errors).toEqual([]);
    let selectors = 0;
    walk(tree, { visit: 'Rule', enter(node) {
      for (const selector of node.prelude.children) {
        expect(generate(selector).startsWith(':host([data-taylors3d-theme="house"]')).toBe(true); selectors++;
      }
    } });
    expect(selectors).toBeGreaterThan(20);
  });
  it('keeps Home Assistant variables intact, with no external resources or generated household text', () => {
    const tree = parse(TAYLORS3D_THEME_CSS), customProperties = [], resources = [], content = [];
    walk(tree, { enter(node) {
      if (node.type === 'Declaration' && node.property.startsWith('--')) customProperties.push(node.property);
      if (node.type === 'Url') resources.push(node.value);
      if (node.type === 'Atrule' && ['import', 'font-face'].includes(node.name)) resources.push(node.name);
      if (node.type === 'Declaration' && node.property === 'content') content.push(generate(node.value));
    } });
    expect(customProperties.length).toBeGreaterThan(20);
    expect(customProperties.every((property) => property.startsWith('--taylors3d-'))).toBe(true);
    expect(resources).toEqual([]); expect(content).toEqual([]);
  });
  it('leaves native hidden flags stronger than decorative flex/grid layout', () => {
    const tree = parse(TAYLORS3D_THEME_CSS), hidden = [];
    walk(tree, { visit: 'Rule', enter(node) {
      if (generate(node.prelude).endsWith('[hidden]')) hidden.push(node);
    } });
    expect(hidden).toHaveLength(1);
    const declarations = hidden[0].block.children.toArray();
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({ property: 'display', important: true });
    expect(generate(declarations[0].value)).toBe('none');
  });
  it('uses equally specific forced-colour overrides for explicitly light and dark hosts', () => {
    const tree = parse(TAYLORS3D_THEME_CSS), overrides = [];
    walk(tree, { visit: 'Atrule', enter(node) {
      if (node.name === 'media' && generate(node.prelude).includes('forced-colors:active')) overrides.push(node);
    } });
    expect(overrides).toHaveLength(1);
    const rule = overrides[0].block.children.first;
    expect(generate(rule.prelude)).toContain('[data-taylors3d-scheme]');
    const declarations = rule.block.children.toArray();
    expect(generate(declarations.find((entry) => entry.property === '--taylors3d-ui-text').value).trim()).toBe('CanvasText');
    expect(generate(declarations.find((entry) => entry.property === '--taylors3d-ui-focus').value).trim()).toBe('Highlight');
  });
});
