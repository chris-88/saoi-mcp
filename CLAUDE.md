# CLAUDE.md

Guidance for the development agent working on this project. Read this fully before making changes, and treat the **Definition of Done** as the bar for every task.

## What this is

`saoi-mcp`: a small Node 24 + TypeScript MCP server at `https://mcp.saoi.ie/mcp` for Saoi's comparison of Irish money products: eleven `saoi_*` tools, two resources (how Saoi ranks, how Saoi earns), two MCP Apps UI resources in `src/ui/` (the plan card and the home calculator card, sharing `bridge.ts`) and two prompts (`saoi`, which is `/saoi` in Claude, and `money-check-up`), over saoi-api's public routes (`SAOI_API_URL`, default `http://saoi-api:3000`; `/api/market/*`, `/api/calc/*`, `POST /api/plans`). Tool input schemas, descriptions and response types are generated from saoi-api's OpenAPI document: `npm run gen`. The engine lives in `chris-88/saoi` (`_shared/domain/market/`); this repo adds nothing to the arithmetic. Design: vault `+/fleeting/baz/2026-11-09-saoi-mcp-tools-design.md`.

**Stack:** `@modelcontextprotocol/server` + `@modelcontextprotocol/node` (SDK v2, `createMcpHandler`) · Zod 4 · plain `node:http` · Vitest · ESLint (typescript-eslint strict) + Prettier · Docker (Node 24 alpine) · hosted by `~/code/infra/stacks/mcp` behind the Cloudflare Tunnel.

## Operating philosophy: lean surface, high floor

Keep the surface lean (no speculative features or dependencies); keep the floor high (strict types, tests, lint, CI from the first commit). When these tension, craft wins.

## Definition of Done

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` and `npm run build` pass.
- [ ] New or changed behaviour has tests; the saoi-api client is mocked (recorded responses in `test/recordings`), never the real stack.
- [ ] Tool input schemas come from the OpenAPI document (`npm run gen`), never hand-written; a missing field description is fixed in saoi's contracts. Tool descriptions say when to use the tool.
- [ ] Nothing returned reads as advice: results state their ranking basis; no "you should". No result contains a single recommended product, lender or combination; ranking is by a stated, changeable objective (decision 2026-11-10).
- [ ] External input is validated at the boundary; failures become `isError` results, not thrown errors.
- [ ] Customer figures and addresses are never logged.
- [ ] Env changes are reflected in `.env.example`, the README table, and `~/code/infra/stacks/mcp`.
- [ ] Conventional commits, focused diff.

## Rules

- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any`, no `@ts-ignore` without a reason.
- Stateless: no sessions, no in-memory state. Nothing about a customer is stored until `saoi_save_plan`.
- A host keeps a connector's tool list until the customer refreshes it, and this stateless server cannot push a change: tool names never change, input schemas only gain optional fields, resources keep their URIs (decision 2026-11-12-saoi-updates-reach-installed-clients).
- A card's address (`ui://saoi/...-vN.html`) is never retired. Bump N when a cached copy would be wrong, add the old address to the card's previous-addresses list, and keep serving it: ChatGPT holds a connector's tool list until the customer refreshes it, and a retired address shows as an empty frame (2026-11-12).
- Forward the end user's address (`CF-Connecting-IP`) to saoi-api as `X-Forwarded-For`: its rate limits are per address.
- Serve both protocol eras (2026-07-28 and legacy `initialize`) via `createMcpHandler`; do not hand-roll JSON-RPC.
- Keep Origin and Host validation on every request. `X-Accel-Buffering: no` on `/mcp`.
- No secrets: the routes are public. If one is ever needed, it comes from env rendered by infra, never from files in this repo.
- Auth is deliberately absent for now (public tools). Adding OAuth means protected resource metadata at `/.well-known/oauth-protected-resource` and bearer validation; discuss first.

## Deploy

Image is built locally by `~/code/infra/stacks/mcp/docker-compose.yml` (`build: ~/code/saoi-mcp`). After pushing to `main`: `cd ~/code/infra/stacks/mcp && sudo docker compose up -d --build`, then `curl https://mcp.saoi.ie/health`.
