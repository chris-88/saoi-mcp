# CLAUDE.md

Guidance for the development agent working on this project. Read this fully before making changes, and treat the **Definition of Done** as the bar for every task.

## What this is

`baz-mcp`: a small Node 24 + TypeScript MCP server at `https://mcp.chrisquinn.ie/mcp` exposing Saoirse (the assistant inside Saoi, the product) as four tools (`saoirse_start`, `saoirse_say`, `saoirse_act`, `saoirse_status`) over the `baz-api` Node service (`BAZ_API_URL`, default `http://baz-api:3000`, routes under `/api`); Supabase auth only mints the synthetic customer. API types are generated: `npm run gen`. Internal names stay `baz-*` (env vars, files, client modules) until the fresh-history rename. All data is synthetic Demo Bank data. It replaces the POC's Deno `mcp` edge function (`digital-hack`, branch `next`).

**Stack:** `@modelcontextprotocol/server` + `@modelcontextprotocol/node` (SDK v2, `createMcpHandler`) · Zod 4 · plain `node:http` · Vitest · ESLint (typescript-eslint strict) + Prettier · Docker (Node 24 alpine) · hosted by `~/code/infra/stacks/mcp` behind the Cloudflare Tunnel.

## Operating philosophy: lean surface, high floor

Keep the surface lean (no speculative features or dependencies); keep the floor high (strict types, tests, lint, CI from the first commit). When these tension, craft wins.

## Definition of Done

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` and `npm run build` pass.
- [ ] New or changed behaviour has tests; the Saoirse client is mocked, never the real stack.
- [ ] Every tool input field has a Zod schema with `.describe()`; tool descriptions say when to use the tool and that data is synthetic.
- [ ] External input is validated at the boundary; failures become `isError` results, not thrown errors.
- [ ] Handles, keys and credentials are never logged or returned in errors.
- [ ] Env changes are reflected in `.env.example`, the README table, and `~/code/infra/stacks/mcp`.
- [ ] Conventional commits, focused diff.

## Rules

- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any`, no `@ts-ignore` without a reason.
- Stateless: no sessions, no in-memory conversation state. State lives in Saoirse; the handle carries identity.
- Serve both protocol eras (2026-07-28 and legacy `initialize`) via `createMcpHandler`; do not hand-roll JSON-RPC.
- Keep Origin and Host validation on every request. `X-Accel-Buffering: no` on `/mcp`.
- Keys come from env (`pass show infra/baz/<KEY>` rendered by infra), never from files in this repo.
- Auth is deliberately absent for now (public synthetic tools). Adding OAuth means protected resource metadata at `/.well-known/oauth-protected-resource` and bearer validation; discuss first.

## Deploy

Image is built locally by `~/code/infra/stacks/mcp/docker-compose.yml` (`build: ~/code/baz-mcp`). After pushing to `main`: `cd ~/code/infra/stacks/mcp && sudo docker compose up -d --build`, then `curl https://mcp.saoi.ie/health`.
