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

**Information, not advice.** Every result is ranked by a stated objective the customer can change, and carries its source (the provider's own site, or the CCPC comparison tables, with CCPC's attribution), when it was checked and last changed, what the data does not say (never treated as zero), and eligibility to check. **Connect it and just talk:** the host calls `saoi_money_check` as soon as the customer talks about their own money; no prompt is needed. **Only a plan is stored:** the customer's circumstances travel in each call, and each plan is held for 24 hours behind a single-use link ("Save this plan to the Saoi app"), then deleted unless opened.

It is a thin adapter over `saoi-api`'s public routes (`/api/market/*`, `/api/calc/*`, `POST /api/plans`); all the logic lives in `saoi` (`supabase/functions/_shared/domain/market/`). Tool input schemas and descriptions are generated from `saoi-api`'s OpenAPI document (`npm run gen` writes `src/generated/operations.ts` and the response types in `src/generated/saoi-api.d.ts`; both are committed).

## Tools

| Tool                      | Route                               | Use it to                                                                                           |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `saoi_money_check`        | `POST /api/calc/money-check`        | Start here: whatever was said so far; the review, a plan or the questions that unlock one, the link |
| `saoi_review_situation`   | `POST /api/calc/review-situation`   | Findings with euro figures (idle money, no emergency fund, debt costing more than savings earn)     |
| `saoi_search_products`    | `POST /api/market/search`           | Rank one category for the customer's amounts; top 5 by default                                      |
| `saoi_product`            | `GET /api/market/products/{id}`     | One product in full: rate history, unknowns, the source's own words                                 |
| `saoi_savings_projection` | `POST /api/calc/savings-projection` | Month by month, net of DIRT, within caps and tiers; the month a target is reached                   |
| `saoi_mortgage`           | `POST /api/calc/mortgage`           | `mode: affordability` (Central Bank limits) or `mode: switch` (saving, cashback, break-even)        |
| `saoi_debt`               | `POST /api/calc/debt`               | What debts cost, payoff order, overpay versus save, refinance rates                                 |
| `saoi_build_plan`         | `POST /api/calc/build-plan`         | Compare the options: a worked combination with other splits; for a home every option, filtered      |
| `saoi_home_calculator`    | `POST /api/calc/home`               | The home calculator card: limits, deposit and date as inputs move; plain questions elsewhere        |
| `saoi_first_home`         | `POST /api/calc/first-home`         | Help to Buy, the Central Bank limits with it, green rates; every rule with its source page          |
| `saoi_save_plan`          | `POST /api/plans`                   | A fresh 24-hour link, for a plan that came back without one                                         |

Every result's text opens with **Present to the customer**: the headline sentences (money found, one net figure per scenario, the save link for a plan), then the detail. Review and plan results carry **money found**: one euro-a-year figure in sourced, dated parts, with what is not counted (unconfirmed rates, unknown current rates, bonuses) shown apart. `saoi_money_check`, `saoi_build_plan` and `saoi_save_plan` write (the 24-hour plan link); the rest are annotated read-only. Each result is structured content (saoi-api's response as is) plus a short text rendering with the figures, flags, unknowns, the data date and the CCPC attribution, for hosts that do not read structured content.

**Resources:** `saoi://about/ranking` (how Saoi ranks) and `saoi://about/earnings` (how Saoi earns: free, nothing from any provider), Markdown from `GET /api/market/about/*`.

**Compare, never pick (decision 2026-11-10):** no result picks a product, lender or combination for the customer. Home options come back every one that fits the customer's own filters (`homePreferences`), in the order they pick; their preferences are stated as their filters. Every result closes with "Saoi is not regulated by the Central Bank of Ireland and does not give advice", and mortgage results carry the three statutory warnings.

**Home calculator card (MCP Apps):** `saoi_home_calculator` declares `ui://saoi/home-calculator-v3.html`: sliders each with a typed box (deposit, monthly saving, income and a second income, price, repayments, date), the customer's filters, live figures worked out in the card from the `rules` saoi-api sent, and **Show my options**, which calls `saoi_build_plan` through the host (`tools/call`), tells the model the inputs (`ui/update-model-context`) and lists every option, sortable by cost over 5 years, keys date or monthly repayment, with **Save this comparison**. The `ui/*` bridge is `src/ui/bridge.ts`.

**Plan card (MCP Apps):** `saoi_money_check` and `saoi_build_plan` declare `_meta.ui.resourceUri` = `ui://saoi/plan-card-v10.html`, an MCP Apps UI resource (`text/html;profile=mcp-app`, extension `io.modelcontextprotocol/ui`, spec 2026-01-26). Hosts that render MCP Apps (claude.ai web, desktop and mobile; ChatGPT) show Saoi's own card with the result: for a home, the date the deposit is in place, the filters applied and every option, sortable in the card; money found, the products with figures, checks and deposit guarantees, the position with any assumed repayment, one compact row per alternative compared in the same call, the net position per scenario, the ranking basis and CCPC attribution, and **Save this comparison**, which opens the result's 24-hour `saveLink` (or, when there is none, calls `saoi_save_plan` and opens the claim link). Other hosts read the text content as before. The card is one inline document (`src/ui/`): no external scripts; its only CSP allowance is `https://assets.claude.ai` for Claude's fonts. Bump the URI's version when the card changes in a way a cached copy would get wrong.

**Server instructions** (sent at `initialize`): call `saoi_money_check` as soon as the customer talks about their own money in Ireland; Saoi's tools are the source for Irish product and scheme facts (rates, deposit guarantees, Help to Buy, the Central Bank limits), not the web; relay the "Present to the customer" block first; present options with figures, never instructions; compare scenarios by their net figures and call a tool again to change an assumption; always give the save link, which holds the plan for 24 hours and is the only thing stored. One plan call per reply: `saoi_money_check` first, `saoi_build_plan` for later replies, never both and never once per option; options are compared through up to three `alternatives` in that one call.

**Prompt:** `money-check-up` (optional `focus`), optional: situation, then `saoi_review_situation`, goals, `saoi_build_plan`, then the save link. Nothing depends on it. It asks only for what the tools need and never phrases results as advice.

**Logs:** one JSON line per tool call (`{"event":"tool_call","tool","ms","outcome","ui"}`: the tool, its duration, `ok` or `error`, and whether the plan card was attached), for diagnosing a test with `docker logs saoi-mcp`. Never the inputs, the caller's address or any figure.

## Protocol

Built on the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2) using `createMcpHandler`. Stateless Streamable HTTP, `POST /mcp` only. It serves both the 2026-07-28 per-request path (`server/discover`, `_meta` envelope, `Mcp-Method`/`Mcp-Name` headers) and the legacy `initialize` path; `GET /mcp` is 405. `Origin` (when present) and `Host` are validated, `X-Accel-Buffering: no` is set, and SSE keep-alive comments go out every 25 seconds. `GET /health` returns `{ ok, version }`.

No authentication and no secrets: the routes it calls are public. saoi-api rate-limits per address, so the end user's address (`CF-Connecting-IP`, set by the Cloudflare Tunnel) is forwarded as `X-Forwarded-For`; otherwise every user of this server would share one bucket.

## Environment

| Variable          | Required | Meaning                                                                                       |
| ----------------- | -------- | --------------------------------------------------------------------------------------------- |
| `SAOI_API_URL`    | no       | The `saoi-api` service, default `http://saoi-api:3000`                                        |
| `PORT`            | no       | Default `3000`                                                                                |
| `SAOI_TIMEOUT_MS` | no       | Per-call timeout to saoi-api, default `30000`                                                 |
| `ALLOWED_HOSTS`   | no       | Comma-separated Host names, default `mcp.saoi.ie,mcp.chrisquinn.ie,localhost,127.0.0.1,[::1]` |
| `ALLOWED_ORIGINS` | no       | Comma-separated Origin host names, default includes `claude.ai`, `claude.com`                 |
| `KEEPALIVE_MS`    | no       | SSE keep-alive interval, default `25000`                                                      |

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
