# ClawGateway

Enterprise auth gateway for [OpenClaw](https://github.com/openclaw/openclaw). Sits in front of OpenClaw Studio and routes authenticated users to role-scoped OpenClaw instances via SSO.

```
Browser → ClawGateway (:8422)
  ├── /login, /auth/*     → SSO (Okta, WorkOS, Descope, Twitter)
  ├── /admin              → Admin dashboard (API keys, models, tools)
  ├── /* (authenticated)  → Proxy to OpenClaw Studio (:3000)
  └── /api/gateway/ws     → WebSocket → OpenClaw instance by role
        ├── viewer → :18789  (read-only)
        ├── member → :18790  (standard access)
        └── admin  → :18791  (full access)
```

## Features

- **SSO Authentication** — Okta, WorkOS, Descope OIDC + Twitter OAuth 2.0 with PKCE
- **Role-based Routing** — IDP groups mapped to roles, each role routes to a separate OpenClaw instance
- **Marketplace Mode** — Twitter login + pre-built bot profiles for public-facing deployments
- **Admin Dashboard** — Configure API keys, models, and tool permissions per role at `/admin`
- **Tool Scoping** — Per-role tool profiles (minimal/coding/messaging/full) with allow/deny overrides
- **WebSocket Routing** — Intercepts `/api/gateway/ws` and routes to the correct OpenClaw instance with token auth
- **Zero Dependencies** — Pure Node.js built-ins (`node:http`, `node:crypto`, `node:fs`)
- **Hot Reload** — Config changes apply without restart
- **Docker Compose** — Full stack deployment with one command

## Quick Start (Docker)

```bash
# 1. Clone
git clone https://github.com/runnerelectrode/clawgateway.git
cd clawgateway

# 2. Generate .env with random tokens
./docker/generate-env.sh

# 3. Edit .env — add your SSO credentials and API key
nano .env

# 4. Deploy
docker compose up --build -d

# 5. Visit http://localhost:8422
```

## Quick Start (Local)

```bash
# 1. Start OpenClaw instances (one per role)
openclaw --profile viewer gateway --port 18789
openclaw --profile member gateway --port 18790
openclaw --profile admin  gateway --port 18791

# 2. Start OpenClaw Studio
npx openclaw-studio@latest

# 3. Start ClawGateway
node bin/clawgateway.mjs --config gateway.example.json
```

## Configuration

### Enterprise Mode

```json
{
  "port": 8422,
  "sessionSecret": "your-secret-at-least-32-chars",
  "mode": "enterprise",
  "studioUpstream": "http://127.0.0.1:3000",
  "callbackUrl": "http://localhost:8422/auth/callback",
  "auth": [
    {
      "provider": "okta",
      "issuer": "https://dev-XXXXX.okta.com",
      "clientId": "...",
      "clientSecret": "...",
      "roleMapping": {
        "Engineering": "admin",
        "Support": "viewer",
        "default": "member"
      }
    }
  ],
  "roles": {
    "viewer": {
      "upstream": "http://127.0.0.1:18789",
      "token": "gateway-auth-token",
      "tools": ["read", "web_fetch"],
      "description": "Read-only access"
    },
    "member": {
      "upstream": "http://127.0.0.1:18790",
      "token": "gateway-auth-token",
      "tools": ["read", "write", "edit", "exec"],
      "description": "Standard development access"
    },
    "admin": {
      "upstream": "http://127.0.0.1:18791",
      "token": "gateway-auth-token",
      "tools": [],
      "description": "Full access"
    }
  },
  "admins": ["admin@example.com"]
}
```

### Marketplace Mode

```json
{
  "port": 8422,
  "mode": "marketplace",
  "auth": [{ "provider": "twitter", "clientId": "...", "clientSecret": "..." }],
  "profiles": {
    "coding-assistant": {
      "upstream": "http://127.0.0.1:18789",
      "description": "Full-stack coding assistant",
      "default": true
    },
    "research-bot": {
      "upstream": "http://127.0.0.1:18790",
      "description": "Read-only research assistant"
    }
  }
}
```

## Admin Dashboard

Access `/admin` (requires admin role or email in `admins` list) to:

- Set **API keys** per role (writes to `~/.openclaw/openclaw-{profile}.json`)
- Select **models** per role (Claude, GPT-4o, Gemini, DeepSeek)
- Configure **tool permissions** with profile presets and individual allow/deny
- View **SSO role mappings** and **audit logs**
- See **setup commands** for OpenClaw instances

Changes hot-apply to running OpenClaw instances without restart.

## Docker Services

| Service | Port | Purpose |
|---------|------|---------|
| `gateway` | **8422** (exposed) | Auth + routing |
| `studio` | 3000 (internal) | OpenClaw Studio UI |
| `openclaw-viewer` | 18789 (internal) | Viewer role instance |
| `openclaw-member` | 18790 (internal) | Member role instance |
| `openclaw-admin` | 18791 (internal) | Admin role instance |
| `init` | — | One-time config generation |

## Project Structure

```
clawgateway/
├── bin/clawgateway.mjs          # CLI entry point
├── src/
│   ├── index.mjs                # Server orchestrator
│   ├── router.mjs               # Route dispatcher + admin API
│   ├── proxy.mjs                # HTTP + WebSocket reverse proxy
│   ├── session.mjs              # HMAC-SHA256 signed cookies
│   ├── config.mjs               # Config loader + hot-reload
│   ├── profiles.mjs             # OpenClaw profile config manager
│   ├── ratelimit.mjs            # Rate limiter for auth endpoints
│   ├── audit.mjs                # JSONL audit logger
│   ├── auth/
│   │   ├── index.mjs            # Provider factory + role resolution
│   │   ├── okta.mjs             # Okta OIDC
│   │   ├── workos.mjs           # WorkOS SSO
│   │   ├── descope.mjs          # Descope OIDC
│   │   └── twitter.mjs          # Twitter OAuth 2.0 + PKCE
│   └── ui/
│       ├── login.mjs            # Login page
│       └── admin.mjs            # Admin dashboard
├── docker-compose.yml           # Full stack deployment
├── Dockerfile                   # ClawGateway image
├── Dockerfile.openclaw          # OpenClaw instance image
├── Dockerfile.studio            # OpenClaw Studio image
├── docker/
│   ├── init.sh                  # Config generation script
│   └── generate-env.sh          # .env file generator
├── gateway.example.json         # Enterprise config example
└── marketplace.example.json     # Marketplace config example
```

## License

MIT
