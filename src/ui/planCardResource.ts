import { createHash } from 'node:crypto'
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
export const PLAN_CARD_URI = 'ui://saoi/plan-card-v11.html'
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** On a tool: the card that renders its result. The flat key is the spec's legacy spelling. */
export const PLAN_CARD_TOOL_META = { ui: { resourceUri: PLAN_CARD_URI }, 'ui/resourceUri': PLAN_CARD_URI }

/**
 * Claude's sandbox origin for the cards (`_meta.ui.domain`): the first 32 hex characters of the
 * SHA-256 of the exact connector URL, then `.claudemcpcontent.com`. Claude checks it against the
 * URL the connector was added with and refuses the card on a mismatch.
 * https://claude.com/docs/connectors/building/mcp-apps/getting-started#set-ui-domain-for-claude
 */
export function claudeUiDomain(publicUrl: string): string {
  return `${createHash('sha256').update(publicUrl).digest('hex').slice(0, 32)}.claudemcpcontent.com`
}

/**
 * On the resource. No external origins: everything is inline. Claude's fonts come from
 * assets.claude.ai (its design guidance asks for it so the card reads as native); elsewhere the
 * system font is used.
 */
export function cardResourceMeta() {
  // No `ui.domain` (2026-11-12): ChatGPT reads the same field and tries to serve the card from
  // that domain, which it cannot, so the frame stays empty there (Chris's test 13). Claude shows
  // the card without it. `claudeUiDomain` stays for the directory listing, which needs it; when
  // it goes back, it must be host-specific or ChatGPT-verified first.
  return {
    ui: {
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: ['https://assets.claude.ai'] },
    },
  }
}

/** The cards' shared style: Claude's variables where the host sends them, Saoi's colours otherwise. */
export const STYLE = `
:root {
  color-scheme: light dark;
  --background: var(--color-background-primary, light-dark(#ffffff, #09090b));
  --foreground: var(--color-text-primary, light-dark(#09090b, #fafafa));
  --muted: light-dark(#f4f4f5, #27272a);
  --muted-foreground: var(--color-text-secondary, light-dark(#71717a, #a1a1aa));
  --border: var(--color-border-tertiary, light-dark(#e4e4e7, #27272a));
  --input: light-dark(#e4e4e7, #3f3f46);
  /* Fill: a calm teal in both themes, as shadcn's primary; text on it stays readable. */
  --primary: light-dark(#0f766e, #0f766e);
  --primary-foreground: light-dark(#ffffff, #f0fdfa);
  /* Teal as text (links, the claim link) needs to be lighter on a dark background. */
  --primary-text: light-dark(#0f766e, #5eead4);
  --radius: 8px;
  /* Older names the plan card's classes use. */
  --fg: var(--foreground); --fg2: var(--muted-foreground); --fg3: var(--muted-foreground);
  --line: var(--border); --surface: var(--background); --saoi: var(--primary); --saoi-ink: var(--primary-foreground);
}
:root[data-theme='light'] { color-scheme: light; }
:root[data-theme='dark'] { color-scheme: dark; }
html, body { margin: 0; background: transparent; }
body {
  font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-size: 14px; line-height: 1.45; color: var(--foreground); -webkit-text-size-adjust: 100%;
}
* { box-sizing: border-box; }
p, h2, h3, ul, ol { margin: 0; }
button, input, select { font: inherit; color: inherit; }
.card { background: var(--background); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.header { padding: 20px 16px 4px; display: grid; gap: 2px; }
.eyebrow { color: var(--muted-foreground); font-size: 12px; font-weight: 500; }
.title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; text-wrap: balance; }
.section { padding: 16px; display: grid; gap: 12px; }
.section + .section, .sep { border-top: 1px solid var(--border); }
.label { font-size: 14px; font-weight: 600; }
.found { padding: 16px; display: grid; gap: 8px; }
.found-headline { font-weight: 600; }
.rows { list-style: none; padding: 0; display: grid; gap: 6px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.products { list-style: none; padding: 0; display: grid; }
.product { padding: 10px 0; display: grid; gap: 3px; }
.product + .product { border-top: 1px solid var(--border); }
.products.section { gap: 0; padding: 4px 16px; }
.products.section > li { padding: 10px 0; }
.products.section > li + li { border-top: 1px solid var(--border); }
.product-name { min-width: 0; }
.flags { padding-left: 18px; display: grid; gap: 2px; color: var(--muted-foreground); }
.position { display: grid; gap: 6px; }
.total { font-size: 16px; font-weight: 600; }
.guarantee { color: var(--muted-foreground); }
.flag { color: var(--muted-foreground); }
.strong { font-weight: 600; }
.medium { font-weight: 500; }
.muted, .muted-strong { color: var(--muted-foreground); }
.small { font-size: 12px; line-height: 1.4; }
.block { display: block; }
.num { font-variant-numeric: tabular-nums; }
.big { font-size: 15px; font-weight: 600; }
/* Collapsible */
.folds { border-top: 1px solid var(--border); }
.more { padding: 0 16px; }
.more + .more { border-top: 1px solid var(--border); }
.more > summary, .collapsible > summary {
  cursor: pointer; min-height: 44px; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; list-style: none; font-weight: 500; color: var(--foreground);
}
.more > summary::-webkit-details-marker, .collapsible > summary::-webkit-details-marker { display: none; }
.more > summary::after, .collapsible > summary::after {
  content: ''; width: 7px; height: 7px; border-right: 1.5px solid var(--muted-foreground);
  border-bottom: 1.5px solid var(--muted-foreground); transform: rotate(45deg) translateY(-2px); transition: transform 0.15s;
}
.more[open] > summary::after, .collapsible[open] > summary::after { transform: rotate(-135deg) translateY(-2px); }
.fold { display: grid; gap: 8px; padding-bottom: 12px; }
.collapsible { border-top: 1px solid var(--border); }
.collapsible > .fold { padding-top: 4px; }
summary:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, [role='switch']:focus-visible {
  outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 6px;
}
/* Buttons */
.save, .btn {
  min-height: 44px; padding: 0 16px; width: 100%; border: 0; border-radius: var(--radius);
  background: var(--primary); color: var(--primary-foreground); font-weight: 500; cursor: pointer;
}
.save:hover, .btn:hover { opacity: 0.92; }
.save:disabled, .btn:disabled { opacity: 0.5; cursor: progress; }
.btn-outline {
  min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--background); font-weight: 500; cursor: pointer;
}
.btn-ghost, .link {
  min-height: 44px; padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
  color: var(--primary-text); font-weight: 500; justify-self: start;
}
.badge {
  display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 6px;
  border: 1px solid var(--border); font-size: 11px; font-weight: 500; color: var(--muted-foreground);
  vertical-align: 1px; margin-left: 6px; white-space: nowrap;
}
/* Segmented control and toggle group */
.segmented { display: flex; gap: 2px; padding: 3px; background: var(--muted); border-radius: var(--radius); }
.segmented > button {
  flex: 1; min-height: 44px; border: 0; border-radius: 6px; background: transparent; cursor: pointer;
  color: var(--muted-foreground); font-weight: 500; padding: 0 8px;
}
.segmented > button[aria-pressed='true'] {
  background: var(--background); color: var(--foreground); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.footer { border-top: 1px solid var(--border); padding: 12px 16px; display: grid; gap: 4px; color: var(--muted-foreground); }
.actions { border-top: 1px solid var(--border); padding: 16px; display: grid; gap: 8px; }
.status { color: var(--muted-foreground); font-size: 12px; }
.status:empty { display: none; }
.claim { color: var(--primary-text); word-break: break-all; }
.scenarios { width: 100%; border-collapse: collapse; }
.scenarios th { text-align: left; font-weight: 400; padding: 6px 0; }
.scenarios td { text-align: right; padding: 6px 0 6px 12px; vertical-align: top; white-space: nowrap; }
.scenarios tr + tr th, .scenarios tr + tr td { border-top: 1px solid var(--border); }
.skeleton { padding: 16px; display: grid; gap: 10px; }
.skeleton span { display: block; height: 12px; border-radius: 6px; background: var(--muted); }
.skeleton span:nth-child(1) { width: 40%; } .skeleton span:nth-child(2) { width: 85%; } .skeleton span:nth-child(3) { width: 65%; }
@media (prefers-reduced-motion: no-preference) {
  .skeleton span { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.5; } }
}
/* Option rows (both cards) */
.options { list-style: none; padding: 0; margin: 0; }
.options > li + li { border-top: 1px solid var(--border); }
.option-head {
  width: 100%; min-height: 56px; padding: 10px 0; border: 0; background: none; cursor: pointer; text-align: left;
  display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; align-items: center;
}
.option-head .right { text-align: right; }
.option-body { display: grid; gap: 6px; padding: 0 0 12px; }
[hidden] { display: none !important; }
.kv { display: flex; justify-content: space-between; gap: 12px; }
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

export function registerPlanCard(server: McpServer, publicUrl: string): void {
  html ??= planCardHtml()
  const text = html
  const meta = cardResourceMeta()
  server.registerResource(
    'saoi-plan-card',
    PLAN_CARD_URI,
    {
      title: 'Saoi plan card',
      description:
        'The interactive card hosts show with saoi_build_plan results, with a button to save the plan.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: meta,
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text, _meta: meta }],
    }),
  )
}
