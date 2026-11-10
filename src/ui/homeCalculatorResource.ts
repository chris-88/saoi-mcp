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
export const HOME_CALCULATOR_URI = 'ui://saoi/home-calculator-v1.html'

export const HOME_CALCULATOR_TOOL_META = {
  ui: { resourceUri: HOME_CALCULATOR_URI },
  'ui/resourceUri': HOME_CALCULATOR_URI,
}

const EXTRA_STYLE = `
.field { display: grid; gap: 4px; padding: 4px 0; }
.boxwrap { display: inline-flex; align-items: center; gap: 4px; }
.box {
  font: inherit; color: var(--fg); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--border-radius-md, 8px);
  min-height: 40px; padding: 4px 8px; width: 120px; text-align: right;
}
select.box { width: 100%; text-align: left; }
input[type='month'].box { width: 150px; }
.slider { width: 100%; min-height: 32px; accent-color: var(--saoi); margin: 0; }
.choice { border: 0; padding: 4px 0; margin: 0; display: grid; gap: 6px; }
.choice legend { padding: 0; margin-bottom: 6px; }
.segments { display: flex; flex-wrap: wrap; gap: 6px; }
.segment {
  min-height: 40px; padding: 0 12px; font: inherit; cursor: pointer;
  border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--fg);
}
.segment.on { border-color: var(--saoi); background: var(--saoi-tint); font-weight: 600; }
.segment:focus-visible, .box:focus-visible, .slider:focus-visible { outline: 2px solid var(--saoi); outline-offset: 2px; }
.check { display: flex; gap: 8px; align-items: center; min-height: 40px; }
.check input { width: 20px; height: 20px; accent-color: var(--saoi); }
.options { list-style: none; padding: 0; margin: 0; display: grid; }
.option { padding: 10px 0; display: grid; gap: 3px; }
.option + .option { border-top: 1px solid var(--line); }
.figs { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--fg2); }
.filter { color: var(--saoi); font-weight: 600; }
.link { background: none; border: 0; padding: 8px 0; color: var(--saoi); font: inherit; cursor: pointer; justify-self: start; min-height: 44px; }
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
