# baz-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes Baz, a conversational banking assistant for a fictional "Demo Bank", as four tools. **All data is synthetic**; nothing real is opened and no money moves. Live at `https://mcp.chrisquinn.ie/mcp`.

It is a thin adapter: each tool calls the `baz-api` service's `/api` routes over HTTP (sessions, SSE turns, one route per case action, the case snapshot). Supabase is used only to mint and sign in the synthetic customer. Rules, scoring and eligibility stay in `baz-api`. Types are generated from its OpenAPI document with `npm run gen` (the output, `src/generated/baz-api.d.ts`, is committed).

| Tool         | Use it to                                                        |
| ------------ | ---------------------------------------------------------------- |
| `baz_start`  | Begin a conversation; returns a handle and the opening question  |
| `baz_say`    | Say something as the customer; returns Baz's reply and any cards |
| `baz_act`    | Tap a card for the user once they have decided (read-write)      |
| `baz_status` | Read the state of the applications on the case (read-only)       |

Routes: `baz_start` is `POST /api/sessions`; `baz_say` is `POST /api/cases/:id/turns` (SSE); `baz_status` is `GET /api/cases/:id/snapshot`; `baz_act` is one route per action under `/api/cases/:id/` (`products/select`, `products/:product/decline`, `plans/:id/decisions`, `applications/:id/{submit,pause,resume}`, `linked-accounts`, `transfers`), followed by an action turn.

## Protocol

Built on the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2) using `createMcpHandler`. Stateless Streamable HTTP, `POST /mcp` only. It serves both the 2026-07-28 per-request path (`server/discover`, `_meta` envelope, `Mcp-Method`/`Mcp-Name` headers) and the legacy `initialize` path; `GET /mcp` is 405. `Origin` (when present) and `Host` are validated, `X-Accel-Buffering: no` is set, and SSE keep-alive comments go out every 25 seconds. `GET /health` returns `{ ok, version }`.

There is no authentication yet (public, authless tools). The conversation handle is a documented prototype shortcut: an opaque string encoding a synthetic user minted at `baz_start`. It is never logged. OAuth comes later.

## Environment

| Variable               | Required | Meaning                                                                             |
| ---------------------- | -------- | ----------------------------------------------------------------------------------- |
| `BAZ_BASE_URL`         | yes      | Supabase gateway of the Baz stack (auth only), e.g. `https://api.chrisquinn.ie/baz` |
| `BAZ_API_URL`          | no       | The `baz-api` service, default `http://baz-api:3000`                                |
| `BAZ_ANON_KEY`         | yes      | Anon key, used for auth and as the customer `apikey`                                |
| `BAZ_SERVICE_ROLE_KEY` | yes      | Service role key, used only by `baz_start` to mint a synthetic user                 |
| `PORT`                 | no       | Default `3000`                                                                      |
| `BAZ_TIMEOUT_MS`       | no       | Per-call timeout to the Baz stack, default `60000`                                  |
| `ALLOWED_HOSTS`        | no       | Comma-separated Host names, default `mcp.chrisquinn.ie,localhost,127.0.0.1,[::1]`   |
| `ALLOWED_ORIGINS`      | no       | Comma-separated Origin host names, default includes `claude.ai`, `claude.com`       |
| `KEEPALIVE_MS`         | no       | SSE keep-alive interval, default `25000`                                            |

## Run

```bash
nvm use            # Node 24
npm ci
npm test           # vitest
npm run gen        # regenerate API types from the OpenAPI document
npm run check      # typecheck, lint, format, test, build
BAZ_BASE_URL=... BAZ_ANON_KEY=$(pass show infra/baz/ANON_KEY) \
BAZ_SERVICE_ROLE_KEY=$(pass show infra/baz/SERVICE_ROLE_KEY) npm run dev
curl -s localhost:3000/health
docker build -t baz-mcp . && docker run --rm -p 3000:3000 --env-file .env baz-mcp
```

Production runs from `~/code/infra/stacks/mcp` behind the Cloudflare Tunnel.

## Add it as a connector

- **claude.ai**: Settings, Connectors, Add custom connector, URL `https://mcp.chrisquinn.ie/mcp`, no authentication.
- **Claude Code**: `claude mcp add --transport http baz https://mcp.chrisquinn.ie/mcp`

## Licence

AGPL-3.0-only. Copyright (C) 2026 Chris Quinn. See `LICENSE`.
