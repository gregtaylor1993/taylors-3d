// Browser checks follow the same visible group → Advanced → tab path as a user.
// This helper never calls EditMode methods or skips their normal cleanup.
import { editorGroupForTab } from '../../src/editor-navigation.js';

const selectorFor = (tab) => `[data-act="tab"][data-id="${tab}"]`;
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function nativeClick(page, selector, index, selectedOption) {
  const handle = await page.evaluateHandle((selector, index) => document.querySelectorAll('taylors3d-card')[index]?.shadowRoot.querySelector(selector), selector, index);
  try {
    const node = handle.asElement(); if (!node) throw Error(`Missing editor navigation control ${selector} on card ${index}`);
    await node.evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    try { await page.waitForFunction((element, selector, index) => {
      const shadow = document.querySelectorAll('taylors3d-card')[index]?.shadowRoot, rect = element.getBoundingClientRect();
      const target = shadow?.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const closed = element.closest('details:not([open])');
      return element.isConnected && shadow?.querySelector(selector) === element && !element.disabled && rect.width > 0 && rect.height > 0
        && !element.closest('[hidden]') && (!closed || closed.querySelector(':scope>summary') === element)
        && (target === element || element.contains(target));
    }, { timeout: 10000 }, node, selector, index); } catch (error) {
      const detail = await page.evaluate((element, index) => {
        const shadow = document.querySelectorAll('taylors3d-card')[index]?.shadowRoot, rect = element.getBoundingClientRect();
        const hit = shadow?.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { connected: element.isConnected, disabled: element.disabled, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          hidden: !!element.closest('[hidden]'), closedDetails: element.closest('details:not([open])')?.dataset.editorAdvanced,
          hit: hit?.outerHTML.slice(0, 250), current: shadow?.querySelector('[data-act="editor-group"][aria-pressed="true"]')?.dataset.id,
          viewport: { width: innerWidth, height: innerHeight, scroll: scrollY } };
      }, node, index);
      throw Error(`Editor navigation is unreachable ${selector}: ${JSON.stringify(detail)}; ${error.message}`, { cause: error });
    }
    if (selectedOption === undefined) await node.click();
    else {
      if (!await node.evaluate((element, value) => [...element.options].some((option) => option.value === value && !option.disabled), selectedOption)) throw Error('Unavailable editor group option ' + selectedOption);
      await node.focus(); await node.select(selectedOption);
    }
  } finally { await handle.dispose(); }
  await frames(page);
}

/** Reveal navigation only; the caller still activates its original native tab. */
export async function revealEditorTab(page, selector, index = 0) {
  if (typeof selector !== 'string' || !/\[data-act=["']?tab["']?\]/.test(selector)) return false;
  const tab = /\[data-id=["']?([a-z-]+)["']?\]/.exec(selector)?.[1], group = editorGroupForTab(tab);
  if (!tab || !group) throw Error('Unknown editor tab navigation ' + selector);
  await frames(page);
  const groupSelector = `[data-act="editor-group"][data-id="${group.id}"]`;
  const current = await page.evaluate(({ selector, groupSelector, index }) => {
    const shadow = document.querySelectorAll('taylors3d-card')[index]?.shadowRoot, target = shadow?.querySelector(selector), button = shadow?.querySelector(groupSelector), picker = shadow?.querySelector('[data-field="editor-group"]');
    return { exists: !!target, grouped: !!button || !!picker, currentGroup: button?.getAttribute('aria-pressed') === 'true',
      compact: !!picker?.getClientRects().length && !!picker.getBoundingClientRect().width };
  }, { selector, groupSelector, index });
  if (!current.exists) throw Error(`Unavailable editor tab ${tab} on card ${index}`);
  if (!current.grouped) return true; // Frozen earlier candidates retain their flat navigation.
  if (!current.currentGroup) await nativeClick(page, current.compact ? '[data-field="editor-group"]' : groupSelector, index, current.compact ? group.id : undefined);
  const advanced = await page.evaluate(({ selector, index }) => {
    const target = document.querySelectorAll('taylors3d-card')[index]?.shadowRoot.querySelector(selector), details = target?.closest('[data-editor-advanced]');
    return details && !details.open ? `[data-editor-advanced][data-group="${details.dataset.group}"]>summary` : null;
  }, { selector, index });
  if (advanced) await nativeClick(page, advanced, index);
  return true;
}

/** Use when an old proof selected a tab by text or a synthetic DOM click. */
export async function clickEditorTab(page, tab, index = 0) {
  const selector = selectorFor(tab); await revealEditorTab(page, selector, index); await nativeClick(page, selector, index);
}
