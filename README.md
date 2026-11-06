# saoi-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes Saoirse, the conversational banking assistant inside Saoi, as four tools. The bank is a fictional "Demo Bank" and **all data is synthetic**; nothing real is opened and no money moves. Live at `https://mcp.saoi.ie/mcp` (also `https://mcp.chrisquinn.ie/mcp`).

It is a thin adapter: each tool calls the `saoi-api` service's `/api` routes over HTTP (sessions, SSE turns, one route per case action, the case snapshot). Supabase is used only to mint and sign in the synthetic customer. Rules, scoring and eligibility stay in `saoi-api`. Types are generated from its OpenAPI document with `npm run gen` (the output, `src/generated/saoi-api.d.ts`, is committed).

| Tool             | Use it to                                                            |
| ---------------- | -------------------------------------------------------------------- |
| `saoirse_start`  | Begin a conversation; returns a handle and the opening question      |
| `saoirse_say`    | Say something as the customer; returns Saoirse's reply and any cards |
| `saoirse_act`    | Tap a card for the user once they have decided (read-write)          |
| `saoirse_status` | Read the state of the applications on the case (read-only)           |

Routes: `saoirse_start` is `POST /api/sessions`; `saoirse_say` is `POST /api/cases/:id/turns` (SSE); `saoirse_status` is `GET /api/cases/:id/snapshot`; `saoirse_act` is one route per action under `/api/cases/:id/` (`products/select`, `products/:product/decline`, `plans/:id/decisions`, `applications/:id/{submit,pause,resume}`, `linked-accounts`, `transfers`), followed by an action turn.

## Protocol

Built on the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2) using `createMcpHandler`. Stateless Streamable HTTP, `POST /mcp` only. It serves both the 2026-07-28 per-request path (`server/discover`, `_meta` envelope, `Mcp-Method`/`Mcp-Name` headers) and the legacy `initialize` path; `GET /mcp` is 405. `Origin` (when present) and `Host` are validated, `X-Accel-Buffering: no` is set, and SSE keep-alive comments go out every 25 seconds. `GET /health` returns `{ ok, version }`.

There is no authentication yet (public, authless tools). The conversation handle is a documented prototype shortcut: an opaque string encoding a synthetic user minted at `saoirse_start`. It is never logged. OAuth comes later.

## Environment

| Variable                | Required | Meaning                                                                               |
| ----------------------- | -------- | ------------------------------------------------------------------------------------- |
| `SAOI_BASE_URL`         | yes      | Supabase gateway of the Saoi stack (auth only), e.g. `https://api.chrisquinn.ie/saoi` |
| `SAOI_API_URL`          | no       | The `saoi-api` service, default `http://saoi-api:3000`                                |
| `SAOI_ANON_KEY`         | yes      | Anon key, used for auth and as the customer `apikey`                                  |
| `SAOI_SERVICE_ROLE_KEY` | yes      | Service role key, used only by `saoirse_start` to mint a synthetic user               |
| `PORT`                  | no       | Default `3000`                                                                        |
| `SAOI_TIMEOUT_MS`       | no       | Per-call timeout to the Saoirse stack, default `60000`                                |
| `ALLOWED_HOSTS`         | no       | Comma-separated Host names, default `mcp.chrisquinn.ie,localhost,127.0.0.1,[::1]`     |
| `ALLOWED_ORIGINS`       | no       | Comma-separated Origin host names, default includes `claude.ai`, `claude.com`         |
| `KEEPALIVE_MS`          | no       | SSE keep-alive interval, default `25000`                                              |

## Run

```bash
nvm use            # Node 24
npm ci
npm test           # vitest
npm run gen        # regenerate API types from the OpenAPI document
npm run check      # typecheck, lint, format, test, build
SAOI_BASE_URL=... SAOI_ANON_KEY=$(pass show infra/saoi/ANON_KEY) \
SAOI_SERVICE_ROLE_KEY=$(pass show infra/saoi/SERVICE_ROLE_KEY) npm run dev
curl -s localhost:3000/health
docker build -t saoi-mcp . && docker run --rm -p 3000:3000 --env-file .env saoi-mcp
```

Production runs from `~/code/infra/stacks/mcp` behind the Cloudflare Tunnel.

## Add it as a connector

- **claude.ai**: Settings, Connectors, Add custom connector, URL `https://mcp.saoi.ie/mcp`, no authentication.
- **Claude Code**: `claude mcp add --transport http saoirse https://mcp.saoi.ie/mcp`

## Licence

AGPL-3.0-only. Copyright (C) 2026 Chris Quinn. See `LICENSE`.
