```text
███▄▄████▄▄                   ▄▄█████▄         ▄▄█████▄         ▄▄█████▄       ███
██████▀▀████▄               ▄████▀▀▀███▄     ▄████▀▀▀████     ▄████▀▀▀████     ███
████      ▀██▄              ███ ▄▄▄▄▄        ███      ▀███    ███      ▀███
███  ▀  ▀  ███             ██████████████   ████       ███    ███       ███    ███
▀███      ▄██▀                  ▀▀▀▀▀████    ███      ▄███    ███      ▄███    ███
 ▀████▄▄████▀               ▀████▄▄▄███▀     ▀████▄▄▄█████    ▀████▄▄▄████     ███
   ▀▀████▀▀                   ▀▀█████▀         ▀▀█████▀███      ▀▀█████▀       ███
```

# saoi-mcp

An [MCP](https://modelcontextprotocol.io) server for Saoi: it compares Irish savings, deposit, mortgage, loan, credit card and current account products against the customer's own figures, inside whichever AI the customer already uses. The customer's AI talks; Saoi supplies the facts and the arithmetic (interest after DIRT, repayments, total cost, the month a goal is reached). Live at `https://mcp.saoi.ie/mcp`.

**Information, not advice.** Every result is ranked by a stated objective the customer can change, and carries its source (the provider's own site, or the CCPC comparison tables, with CCPC's attribution), when it was checked and last changed, what the data does not say (never treated as zero), and eligibility to check. **Connect it and just talk:** `saoi_money_check` applies when the customer asks about their own money; no prompt is needed. **What is stored:** the customer's circumstances travel in each call; each plan is held for 24 hours behind a single-use link ("Save this plan to the Saoi app") and deleted then if unopened, and once opened is kept with the Saoi app conversation it opens into. The home calculator records one anonymous, banded row per run (no figures, no identifiers). Nothing else is stored.

It is a thin adapter over `saoi-api`'s public routes (`/api/market/*`, `/api/calc/*`, `POST /api/plans`); all the logic lives in `saoi` (`supabase/functions/_shared/domain/market/`). Tool input schemas and descriptions are generated from `saoi-api`'s OpenAPI document (`npm run gen` writes `src/generated/operations.ts` and the response types in `src/generated/saoi-api.d.ts`; both are committed).

## Tools

| Tool                      | Route                               | Use it to                                                                                             |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `saoi_money_check`        | `POST /api/calc/money-check`        | A first look: whatever was said so far; the review, a plan or the questions that unlock one, the link |
| `saoi_review_situation`   | `POST /api/calc/review-situation`   | Findings with euro figures (idle money, no emergency fund, debt costing more than savings earn)       |
| `saoi_search_products`    | `POST /api/market/search`           | Rank one category for the customer's amounts; top 5 by default                                        |
| `saoi_product`            | `GET /api/market/products/{id}`     | One product in full: rate history, unknowns, the source's own words                                   |
| `saoi_savings_projection` | `POST /api/calc/savings-projection` | Month by month, net of DIRT, within caps and tiers; the month a target is reached                     |
| `saoi_mortgage`           | `POST /api/calc/mortgage`           | `mode: affordability` (Central Bank limits) or `mode: switch` (saving, cashback, break-even)          |
| `saoi_debt`               | `POST /api/calc/debt`               | What debts cost, payoff order, overpay versus save, refinance rates                                   |
| `saoi_build_plan`         | `POST /api/calc/build-plan`         | Compare the options: a worked combination with other splits; for a home every option, filtered        |
| `saoi_home_calculator`    | `POST /api/calc/home`               | One or two plain questions until the core figures are in, then the home calculator card               |
| `saoi_first_home`         | `POST /api/calc/first-home`         | Help to Buy, the Central Bank limits with it, green rates; every rule with its source page            |
| `saoi_save_plan`          | `POST /api/plans`                   | A fresh 24-hour link, for a plan that came back without one                                           |

Every result's text opens with **Present to the customer**: the headline sentences (money found, one net figure per scenario, the save link for a plan), then the detail. Review and plan results carry **money found**: one euro-a-year figure in sourced, dated parts, with what is not counted (unconfirmed rates, unknown current rates, bonuses) shown apart. `saoi_money_check`, `saoi_build_plan` and `saoi_save_plan` write (the 24-hour plan link); the rest are annotated read-only. Each result is structured content (saoi-api's response as is) plus a short text rendering with the figures, flags, unknowns, the data date and the CCPC attribution, for hosts that do not read structured content.

**Resources:** `saoi://about/ranking` (how Saoi ranks) and `saoi://about/earnings` (how Saoi earns: free, nothing from any provider), Markdown from `GET /api/market/about/*`.

**Compare, never pick (decision 2026-11-10):** no result picks a product, lender or combination for the customer. Home options come back every one that fits the customer's own filters (`homePreferences`), in the order they pick; their preferences are stated as their filters. Every result closes with "Saoi is not regulated by the Central Bank of Ireland and does not give advice", and mortgage results carry the three statutory warnings.

**Home calculator card (MCP Apps):** `saoi_home_calculator` declares `ui://saoi/home-calculator-v11.html` (card v8, one phone screen; v9 adds the gate below, v10 draws from the arguments at once and hides only on a gated result, with Saoirse's mark and Lucide icons drawn inline by `src/ui/icons.ts`; v11 lays the tiles out as below; v8 to v10 stay served). When the host passed deposit, monthly saving, income and price, the card starts folded: Saoirse's mark, **Your home-buying plan** and **Edit**, one chip for rent when it was not given (first-time buyer stays assumed, as the footer says, and is answered under Edit), then the month the money for the keys is ready, worked out in the card from the `rules` saoi-api sent (the comparison's keys month once it ran for these inputs; a new build's Help to Buy stays out of it until tax paid is given), what that money is made of (deposit + stamp duty + legal and survey, less Help to Buy when counted), a thin progress bar of deposit saved against it with the rent now when given, three tiles in saoi-api's tile shape (`{ label, qualifier, value, sub, quiet, detail }`), each with its icon beside its label, "up to" or "from" in small text above the value, the values level across the three, and a chevron because a tap opens its detail under the row, one at a time (savings: "up to" the top rate, how many accounts fit, and its interest only when saoi-api worked it out to the month shown as ready to buy, else the detail states the month it runs to, with the basis; mortgage: "from" the lowest monthly repayment, the loan and the lowest rate under it, how many options fit, and in the detail the monthly range over the term, the basis and that lenders decide; could afford: "up to" the most the Central Bank limits allow, and in the detail the limits and the deposit that price needs), all from saoi-api's `market` block and `figures.maxPriceEur`, no provider or lender named), two other supports in saoi-api's order (two-line rows, each opening to its reason or missing detail with a chip for the control that answers it, conditions and source), **See all N supports in Saoi**, **Open in Saoi**, and one footer line that opens what was assumed, the three statutory warnings (the comparison's own once it returned them), the 24-hour note and the statement. The card calls no tool until the customer presses something (hosts do not reliably let a card call tools unprompted). Without those figures the inputs open expanded: sliders each with a typed box (deposit, monthly saving, income and a second income, price, repayments, date, tax paid, rent), the customer's filters and the county, and **Show my options**, which calls `saoi_build_plan` and `saoi_home_calculator` through the host (`tools/call`), tells the model the inputs (`ui/update-model-context`) and folds the card. **Open in Saoi**, the one filled button, and **See all N supports in Saoi**, which does the same, run the comparison when there is none for these inputs, save it through its single-use link and open it in the app, where every product option and support is listed. The `ui/*` bridge is `src/ui/bridge.ts`.

**The core-information gate:** saoi-api's result carries `gate` (`ready`, and the core inputs still `missing`, each a plain question, what it moves, and `askNow` for the one or two to ask next). The core inputs are funds saved, monthly saving, income (a second income when `buyingTogether`), and a price or a date. While `ready` is false, `saoi_home_calculator` returns the `askNow` questions as its whole text, with no figure, tile, assumption or link, and its structured content is only `gate` and the statement; the card, which MCP Apps declares per tool rather than per result, draws nothing for that result (`body` hidden, zero height). The host passes everything the customer has said on every call, so the call after an answer passes the gate. A result without `gate` (saoi-api before it) shows the card as before. Once the card is shown it is the end of the conversation in the host: the server instructions, the tool description and the card's model context all point every follow-up at the card's button, "Compare all product options and supports", and call the tool again only when a figure changes.

**Plan card (MCP Apps):** `saoi_money_check` and `saoi_build_plan` declare `_meta.ui.resourceUri` = `ui://saoi/plan-card-v11.html`, an MCP Apps UI resource (`text/html;profile=mcp-app`, extension `io.modelcontextprotocol/ui`, spec 2026-01-26). Hosts that render MCP Apps (claude.ai web, desktop and mobile; ChatGPT) show Saoi's own card with the result: for a home, the date the deposit is in place, the filters applied and every option, sortable in the card; money found, the products with figures, checks and deposit guarantees, the position with any assumed repayment, one compact row per alternative compared in the same call, the net position per scenario, the ranking basis and CCPC attribution, and **Save this comparison**, which opens the result's 24-hour `saveLink` (or, when there is none, calls `saoi_save_plan` and opens the claim link). Other hosts read the text content as before. The card is one inline document (`src/ui/`): no external scripts; its only CSP allowance is `https://assets.claude.ai` for Claude's fonts. Both cards' resources carry `_meta.ui.domain`, Claude's sandbox origin for them: the first 32 hex characters of the SHA-256 of `PUBLIC_URL`, then `.claudemcpcontent.com` (`9235ca3f8bcb93b4fb0ef0094165a0d9.claudemcpcontent.com` for `https://mcp.saoi.ie/mcp`). Claude checks it against the exact URL the connector was added with, so a connector added at another URL (`mcp.chrisquinn.ie`, or with a trailing slash) gets `ui.domain mismatch` and no card. Bump the URI's version when the card changes in a way a cached copy would get wrong.

**Server instructions** (sent at `initialize`): what the tools cover (Irish products compared against the customer's figures; product rates, deposit guarantees, Help to Buy and the Central Bank limits, with sources and dates; where a tool does not have a fact, say so) and when each applies, written to the Anthropic Connectors Directory and OpenAI plugin directory rules: no instruction to call a tool unprompted, nothing that steers towards or away from other tools. Every tool description starts "Use this when" and names what a sibling tool covers instead. saoi-api's generated summaries and descriptions carry no steering since saoi `7916295`; a test asserts none of the banned phrases reach a host. Each fact is said once per tool: saoi-api's text states what is stored, and its shared not-advice paragraph (in full in the instructions) becomes one short sentence per tool. Relay the "Present to the customer" block first; present options with figures, never instructions; compare scenarios by their net figures. One plan call per reply: `saoi_money_check` first, `saoi_build_plan` for later replies, never both and never once per option; options are compared through up to three `alternatives` in that one call.

**Prompts:** two, both optional; nothing depends on them.

- `saoi` (title "Saoi", optional `said`: what the customer has said so far) starts the home conversation: `saoi_home_calculator` with what was said, the gate's one or two questions and nothing else until the card, then the card's button for anything more. In Claude, MCP prompts appear in the prompt list and as a slash command: type `/` in the message box and choose **Saoi** (shown as `/saoi`, or under the connector's name, depending on the client). ChatGPT has no MCP prompts: the way in there is `@Saoi` in the message.
- `money-check-up` (optional `focus`): situation, then `saoi_review_situation`, goals, `saoi_build_plan`, then the save link. It asks only for what the tools need and never phrases results as advice.

**Logs:** one JSON line per tool call (`{"event":"tool_call","tool","ms","outcome","ui"}`: the tool, its duration, `ok` or `error`, and whether the plan card was attached), for diagnosing a test with `docker logs saoi-mcp`. Never the inputs, the caller's address or any figure.

## Protocol

Built on the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2) using `createMcpHandler`. Stateless Streamable HTTP, `POST /mcp` only. It serves both the 2026-07-28 per-request path (`server/discover`, `_meta` envelope, `Mcp-Method`/`Mcp-Name` headers) and the legacy `initialize` path; `GET /mcp` is 405. `Origin` (when present) and `Host` are validated, `X-Accel-Buffering: no` is set, and SSE keep-alive comments go out every 25 seconds. `GET /health` returns `{ ok, version }`. The server identifies itself as `saoi`, titled `Saoi`, with `websiteUrl` `https://saoi.ie` and two `icons`: Saoi's mark as saoi.ie and app.saoi.ie serve it (`src/icon.ts`), at `GET /icon.svg` and `GET /icon.png` (192 by 192) on `PUBLIC_URL`'s origin.

No authentication and no secrets: the routes it calls are public. saoi-api rate-limits per address, so the end user's address (`CF-Connecting-IP`, set by the Cloudflare Tunnel) is forwarded as `X-Forwarded-For`; otherwise every user of this server would share one bucket.

## Environment

| Variable                | Required | Meaning                                                                                                                                       |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAOI_API_URL`          | no       | The `saoi-api` service, default `http://saoi-api:3000`                                                                                        |
| `PORT`                  | no       | Default `3000`                                                                                                                                |
| `SAOI_TIMEOUT_MS`       | no       | Per-call timeout to saoi-api, default `30000`                                                                                                 |
| `ALLOWED_HOSTS`         | no       | Comma-separated Host names, default `mcp.saoi.ie,mcp.chrisquinn.ie,localhost,127.0.0.1,[::1]`                                                 |
| `ALLOWED_ORIGINS`       | no       | Comma-separated Origin host names (exact match, no wildcards), default includes `claude.ai`, `claude.com`, `chatgpt.com`, `chat.openai.com`   |
| `KEEPALIVE_MS`          | no       | SSE keep-alive interval, default `25000`                                                                                                      |
| `OPENAI_APPS_CHALLENGE` | no       | OpenAI's domain verification token, served as `text/plain` at `GET /.well-known/openai-apps-challenge`; 404 when unset                        |
| `PUBLIC_URL`            | no       | The exact URL connectors use, default `https://mcp.saoi.ie/mcp`: the cards' `ui.domain` is its hash, and the icons are served from its origin |

## Run

```bash
nvm use            # Node 24
npm ci
npm test           # vitest; saoi-api is mocked with recorded responses (test/recordings)
npm run gen        # regenerate tool schemas and API types from the OpenAPI document
npm run check      # typecheck, lint, format, test, build
SAOI_API_URL=https://api.saoi.ie npm run dev
curl -s localhost:3000/health
```

Production runs from `~/code/infra/stacks/mcp` behind the Cloudflare Tunnel.

## Add it to Claude

- **claude.ai (web, desktop, mobile):** Settings, then Connectors, then Add custom connector. Name `Saoi`, URL `https://mcp.saoi.ie/mcp`, no authentication. In a chat, enable it from the tools menu and talk about your money.
- **Claude Code:** `claude mcp add --transport http saoi https://mcp.saoi.ie/mcp`

## Licence

AGPL-3.0-only. Copyright (C) 2026 Chris Quinn. See `LICENSE`.
