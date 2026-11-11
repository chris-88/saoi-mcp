import type { McpServer } from '@modelcontextprotocol/server'
import { createBridge } from './bridge.js'
import { homeCalculatorApp } from './homeCalculatorApp.js'
import { homeCalculatorModel } from './homeCalculatorModel.js'
import { cardIcons } from './icons.js'
import { MCP_APP_MIME_TYPE, PLAN_CARD_RESOURCE_META, STYLE } from './planCardResource.js'

/**
 * The home calculator card (decision 2026-11-10: Saoi compares; the customer sets the filters):
 * an MCP Apps UI resource that hosts which support it render with `saoi_home_calculator`.
 * Card v8 (decision 2026-11-11): one phone screen under Saoirse's mark with the month the money
 * for the keys is ready and what it is made of, a progress bar, three tiles (savings, mortgage,
 * could afford) and two other supports as facts, with icons; sliders with typed boxes and the
 * customer's filters under Edit; "Open in Saoi" (and "See all N routes in Saoi"), which compares,
 * saves and opens it in the app; the assumptions, warnings and statement folded behind one
 * footer line. No tool is called until the customer asks.
 *
 * Bump the version in the URI when the card changes in a way a cached copy would get wrong.
 */
export const HOME_CALCULATOR_URI = 'ui://saoi/home-calculator-v8.html'

export const HOME_CALCULATOR_TOOL_META = {
  ui: { resourceUri: HOME_CALCULATOR_URI },
  'ui/resourceUri': HOME_CALCULATOR_URI,
}

const EXTRA_STYLE = `
.field { display: grid; gap: 6px; }
.field-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.field-head label { font-weight: 500; }
.input-wrap { position: relative; display: inline-flex; align-items: center; }
.input-wrap > span { position: absolute; left: 10px; color: var(--muted-foreground); pointer-events: none; }
.input {
  height: 44px; width: 128px; padding: 0 10px 0 22px; border: 1px solid var(--input); border-radius: var(--radius);
  background: transparent; text-align: right; font-variant-numeric: tabular-nums;
}
.input.plain { padding-left: 10px; width: 150px; }
select.input { width: 100%; text-align: left; padding: 0 10px; appearance: auto; }
.slider { width: 100%; height: 28px; margin: 0; accent-color: var(--primary); cursor: pointer; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; }
[role='switch'] {
  flex: none; width: 44px; height: 44px; padding: 12px 4px; border: 0; background: none; cursor: pointer;
}
[role='switch'] > span {
  display: block; width: 36px; height: 20px; border-radius: 999px; background: var(--input); position: relative; transition: background 0.15s;
}
[role='switch'] > span::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px;
  background: var(--background); box-shadow: 0 1px 2px rgb(0 0 0 / 0.2); transition: transform 0.15s;
}
[role='switch'][aria-checked='true'] > span { background: var(--primary); }
[role='switch'][aria-checked='true'] > span::after { transform: translateX(16px); }
.choice-field { display: grid; gap: 6px; }
.choice-field > p { font-weight: 500; }
.headline { font-weight: 600; font-size: 15px; }
.summary-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.grid { display: grid; gap: 8px; }
.btn-outline.wide { width: 100%; min-height: 44px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--background); color: var(--foreground); font-size: 13px; font-weight: 500; cursor: pointer;
}
.chip[aria-expanded='true'] { border-color: var(--foreground); }
.control { display: grid; gap: 8px; padding-top: 4px; }
.control .btn-outline { justify-self: end; }
.nowrap { white-space: nowrap; }
.icon { flex: none; display: block; }
.with-icon { display: inline-flex; align-items: center; gap: 6px; }
.icon-box {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  background: var(--muted); color: var(--foreground); border-radius: var(--radius);
}
.icon-box-36 { width: 36px; height: 36px; }
.icon-box-32 { width: 32px; height: 32px; }
.head-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 12px; }
.head-lead { display: flex; align-items: center; gap: 10px; min-width: 0; }
.head-row .title { white-space: nowrap; }
.mark { flex: none; display: inline-flex; color: var(--primary); }
.facts { padding: 0 16px 12px; display: grid; gap: 8px; }
.plan { gap: 16px; }
.hero { display: grid; gap: 2px; }
.caps { text-transform: uppercase; letter-spacing: 0.04em; }
.hero-month { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
.meter { display: grid; gap: 4px; }
.bar { height: 6px; border-radius: 999px; background: var(--muted); overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--primary); border-radius: 999px; }
.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.tile {
  border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; min-width: 0;
  display: grid; gap: 2px; align-content: start;
}
.tile p { overflow-wrap: anywhere; }
/* One step under .big (15px): "up to €444,000" stays on one line in a third of 390px. */
.tile .tile-value { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow-wrap: normal; }
.tile-icon { color: var(--muted-foreground); padding-bottom: 2px; }
.label.with-icon { display: flex; }
.label.with-icon .icon { color: var(--muted-foreground); }
.route-head {
  width: 100%; min-height: 56px; padding: 10px 0; border: 0; background: none; cursor: pointer; text-align: left;
  display: flex; align-items: center; gap: 12px;
}
.route-text { flex: 1; min-width: 0; display: grid; gap: 1px; }
.route-head .badge { margin-left: 0; }
.route-head .chevron { color: var(--muted-foreground); transition: transform 0.15s; }
.route-head[aria-expanded='true'] .chevron { transform: rotate(90deg); }
.route-body { padding-left: 44px; }
.link.with-icon { display: inline-flex; }
.btn-open {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 56px; padding: 8px 16px; text-align: left;
}
.btn-words { display: grid; gap: 1px; min-width: 0; }
.btn-sub { opacity: 0.85; }
.foot-toggle {
  display: flex; align-items: center; gap: 6px; width: 100%; min-height: 44px; padding: 0; border: 0;
  background: none; cursor: pointer; text-align: left; color: var(--muted-foreground);
}
.footer { padding: 4px 16px; }
.foot-detail { display: grid; gap: 4px; padding-bottom: 12px; }
@media (prefers-reduced-motion: reduce) { .route-head .chevron { transition: none; } }
`

/** The card's document: markup, style and script all inline. */
export function homeCalculatorHtml(): string {
  const script = [
    '"use strict";',
    `const createBridge = ${createBridge.toString()};`,
    `const homeCalculatorModel = ${homeCalculatorModel.toString()};`,
    `const cardIcons = ${cardIcons.toString()};`,
    `(${homeCalculatorApp.toString()})(window, createBridge(window), homeCalculatorModel(), cardIcons(document));`,
  ].join('\n')
  return [
    '<!DOCTYPE html>',
    '<html lang="en-IE">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<title>Saoi home calculator</title>',
    `<style>${STYLE}${EXTRA_STYLE}</style>`,
    '</head>',
    '<body>',
    '<main id="card" class="card" aria-busy="true" aria-label="Saoi home calculator">',
    '<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>',
    '</main>',
    `<script>${script.replaceAll('</script', '<\\/script')}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}

let html: string | undefined

export function registerHomeCalculatorCard(server: McpServer): void {
  html ??= homeCalculatorHtml()
  const text = html
  server.registerResource(
    'saoi-home-calculator',
    HOME_CALCULATOR_URI,
    {
      title: 'Saoi home calculator',
      description:
        'The interactive calculator hosts show with saoi_home_calculator: the customer’s figures, the month the money for the keys is ready, progress, routes to a home as facts, and Open in Saoi, which compares every option that fits in the app.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: PLAN_CARD_RESOURCE_META,
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text, _meta: PLAN_CARD_RESOURCE_META }],
    }),
  )
}
