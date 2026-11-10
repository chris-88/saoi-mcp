import type { McpServer } from '@modelcontextprotocol/server'
import { planCardApp } from './planCardApp.js'
import { planCardModel } from './planCardModel.js'

/**
 * The plan card: an MCP Apps UI resource (extension `io.modelcontextprotocol/ui`, spec
 * 2026-01-26) that hosts which support it (claude.ai, Claude Desktop and mobile, ChatGPT) render
 * inline with `saoi_build_plan` results. Hosts without it ignore the `_meta` and read the text.
 *
 * Bump the version in the URI when the card changes in a way a cached copy would get wrong:
 * hosts may treat the URI as a cache key.
 */
export const PLAN_CARD_URI = 'ui://saoi/plan-card-v6.html'
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** On a tool: the card that renders its result. The flat key is the spec's legacy spelling. */
export const PLAN_CARD_TOOL_META = { ui: { resourceUri: PLAN_CARD_URI }, 'ui/resourceUri': PLAN_CARD_URI }

/**
 * On the resource. No external origins: everything is inline. Claude's fonts come from
 * assets.claude.ai (its design guidance asks for it so the card reads as native); elsewhere the
 * system font is used.
 */
export const PLAN_CARD_RESOURCE_META = {
  ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: ['https://assets.claude.ai'] } },
}

const STYLE = `
:root {
  color-scheme: light dark;
  --saoi: light-dark(#00736f, oklch(0.76 0.1 190));
  --saoi-ink: light-dark(#ffffff, oklch(0.15 0.03 195));
  --saoi-tint: light-dark(oklch(0.96 0.025 190), oklch(0.3 0.03 195));
  --fg: var(--color-text-primary, light-dark(#0f172a, #f5f5f4));
  --fg2: var(--color-text-secondary, light-dark(#334155, #d6d3d1));
  --fg3: var(--color-text-tertiary, light-dark(#5b6474, #a8a29e));
  --line: var(--color-border-tertiary, light-dark(rgb(15 23 42 / 0.14), rgb(255 255 255 / 0.14)));
  --surface: var(--color-background-primary, light-dark(#ffffff, #1f1f1e));
  --warn-fg: var(--color-text-warning, light-dark(#5a4815, #d1a041));
  --warn-bg: var(--color-background-warning, light-dark(#f6eedf, #483a0f));
  --radius: var(--border-radius-xl, 12px);
}
:root[data-theme='light'] { color-scheme: light; }
:root[data-theme='dark'] { color-scheme: dark; }
html, body { margin: 0; background: transparent; }
body {
  font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-size: var(--font-text-sm-size, 14px);
  line-height: var(--font-text-sm-line-height, 1.4);
  color: var(--fg);
  -webkit-text-size-adjust: 100%;
}
* { box-sizing: border-box; }
p, h2, h3, ul, ol { margin: 0; }
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.header { padding: 14px 16px 10px; border-top: 4px solid var(--saoi); }
.eyebrow, .label {
  color: var(--fg3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.title { margin-top: 4px; font-size: var(--font-heading-md-size, 16px); font-weight: 600; text-wrap: balance; }
.found { background: var(--saoi-tint); padding: 10px 16px; display: grid; gap: 4px; }
.found-headline { font-weight: 600; color: var(--fg); }
.section { border-top: 1px solid var(--line); padding: 10px 16px; display: grid; gap: 6px; }
.rows { list-style: none; padding: 0; display: grid; gap: 4px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.products { list-style: none; padding: 0; display: grid; }
.product { padding: 8px 0; display: grid; gap: 3px; }
.product + .product { border-top: 1px solid var(--line); }
.flags { padding-left: 18px; display: grid; gap: 2px; color: var(--fg2); }
.position { display: grid; gap: 4px; padding-top: 6px; }
.total { font-size: var(--font-heading-md-size, 16px); font-weight: 600; }
.product-name { min-width: 0; }
.products.section { margin: 0; gap: 0; padding: 4px 16px; }
.products.section > li { padding: 6px 0; }
.products.section > li + li { border-top: 1px solid var(--line); }
.folds { border-top: 1px solid var(--line); }
.more { padding: 0 16px; }
.more + .more { border-top: 1px solid var(--line); }
.more summary {
  cursor: pointer; color: var(--fg2); min-height: 44px;
  display: flex; align-items: center; gap: 8px; list-style: none;
}
.more summary::-webkit-details-marker { display: none; }
.more summary::before { content: '▸'; color: var(--fg3); width: 10px; }
.more[open] > summary::before { content: '▾'; }
.more summary:focus-visible { outline: 2px solid var(--saoi); outline-offset: 2px; border-radius: 4px; }
.fold { display: grid; gap: 8px; padding-bottom: 12px; }
.fold .flags { margin-top: 2px; }
.guarantee { color: var(--fg2); }
.flag { color: var(--warn-fg); background: var(--warn-bg); border-radius: 6px; padding: 2px 6px; justify-self: start; }
.scenarios { width: 100%; border-collapse: collapse; }
.scenarios th { text-align: left; font-weight: 400; padding: 4px 0; }
.scenarios td { text-align: right; padding: 4px 0 4px 12px; vertical-align: top; white-space: nowrap; }
.scenarios tr + tr th, .scenarios tr + tr td { border-top: 1px dashed var(--line); }
.badge {
  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; font-weight: 600; color: var(--saoi); border: 1px solid var(--saoi); vertical-align: 1px;
}
.footer { border-top: 1px solid var(--line); padding: 10px 16px; display: grid; gap: 4px; color: var(--fg2); }
.actions { border-top: 1px solid var(--line); padding: 12px 16px; display: grid; gap: 6px; }
.save {
  min-height: 44px; padding: 0 18px; justify-self: start;
  border: 0; border-radius: var(--border-radius-md, 8px);
  background: var(--saoi); color: var(--saoi-ink);
  font: inherit; font-weight: 600; cursor: pointer;
}
.save:hover { filter: brightness(1.08); }
.save:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.save:disabled { opacity: 0.6; cursor: progress; }
.status { color: var(--fg2); font-size: 13px; }
.status:empty { display: none; }
.claim { color: var(--saoi); word-break: break-all; }
.strong { font-weight: 600; }
.muted { color: var(--fg3); }
.muted-strong { color: var(--fg2); }
.small { font-size: 12.5px; }
.block { display: block; }
.num { font-variant-numeric: tabular-nums; }
.skeleton { padding: 16px; display: grid; gap: 10px; }
.skeleton span { display: block; height: 12px; border-radius: 6px; background: var(--line); }
.skeleton span:nth-child(1) { width: 40%; } .skeleton span:nth-child(2) { width: 85%; } .skeleton span:nth-child(3) { width: 65%; }
@media (prefers-reduced-motion: no-preference) {
  .skeleton span { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.5; } }
}
`

/** The card's document: markup, style and script all inline. */
export function planCardHtml(): string {
  const script = `"use strict";\nconst planCardModel = ${planCardModel.toString()};\n(${planCardApp.toString()})(window, planCardModel);`
  return [
    '<!DOCTYPE html>',
    '<html lang="en-IE">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<title>Saoi plan</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main id="card" class="card" aria-busy="true" aria-label="Saoi plan">',
    '<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>',
    '</main>',
    `<script>${script.replaceAll('</script', '<\\/script')}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}

let html: string | undefined

export function registerPlanCard(server: McpServer): void {
  html ??= planCardHtml()
  const text = html
  server.registerResource(
    'saoi-plan-card',
    PLAN_CARD_URI,
    {
      title: 'Saoi plan card',
      description:
        'The interactive card hosts show with saoi_build_plan results, with a button to save the plan.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: PLAN_CARD_RESOURCE_META,
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text, _meta: PLAN_CARD_RESOURCE_META }],
    }),
  )
}
