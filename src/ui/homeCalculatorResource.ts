import type { McpServer } from '@modelcontextprotocol/server'
import { createBridge } from './bridge.js'
import { homeCalculatorApp } from './homeCalculatorApp.js'
import { homeCalculatorModel } from './homeCalculatorModel.js'
import { MCP_APP_MIME_TYPE, PLAN_CARD_RESOURCE_META, STYLE } from './planCardResource.js'

/**
 * The home calculator card (decision 2026-11-10: Saoi compares; the customer sets the filters):
 * an MCP Apps UI resource that hosts which support it render with `saoi_home_calculator`.
 * Sliders with typed boxes, live figures, the customer's filters, and "Show my options", which
 * runs saoi_build_plan through the host and lists every option that fits, sortable.
 *
 * Bump the version in the URI when the card changes in a way a cached copy would get wrong.
 */
export const HOME_CALCULATOR_URI = 'ui://saoi/home-calculator-v2.html'

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
`

/** The card's document: markup, style and script all inline. */
export function homeCalculatorHtml(): string {
  const script = [
    '"use strict";',
    `const createBridge = ${createBridge.toString()};`,
    `const homeCalculatorModel = ${homeCalculatorModel.toString()};`,
    `(${homeCalculatorApp.toString()})(window, createBridge(window), homeCalculatorModel());`,
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
        'The interactive calculator hosts show with saoi_home_calculator: sliders, live figures, the customer’s filters, and every option that fits, sortable.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: PLAN_CARD_RESOURCE_META,
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text, _meta: PLAN_CARD_RESOURCE_META }],
    }),
  )
}
