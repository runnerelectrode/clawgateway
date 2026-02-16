#!/bin/sh
set -e

DATA_DIR="/data"
OPENCLAW_DIR="/root/.openclaw"
STUDIO_DIR="${OPENCLAW_DIR}/openclaw-studio"
GATEWAY_CONFIG="${DATA_DIR}/gateway.json"

echo "[init] ClawGateway initialization starting..."

# --- Validate required env vars ---
if [ -z "${OPENCLAW_TOKEN_VIEWER}" ] || [ -z "${OPENCLAW_TOKEN_MEMBER}" ] || [ -z "${OPENCLAW_TOKEN_ADMIN}" ]; then
  echo "[init] ERROR: OPENCLAW_TOKEN_VIEWER, OPENCLAW_TOKEN_MEMBER, OPENCLAW_TOKEN_ADMIN must be set"
  echo "[init] Run ./docker/generate-env.sh to create a .env file"
  exit 1
fi

if [ -z "${SESSION_SECRET}" ]; then
  echo "[init] ERROR: SESSION_SECRET must be set"
  exit 1
fi

# --- Create directories ---
mkdir -p "${DATA_DIR}"
mkdir -p "${OPENCLAW_DIR}"
mkdir -p "${STUDIO_DIR}"

# --- Write gateway.json (idempotent: only if not exists) ---
if [ ! -f "${GATEWAY_CONFIG}" ]; then
  cat > "${GATEWAY_CONFIG}" << GWEOF
{
  "port": 8422,
  "sessionSecret": "${SESSION_SECRET}",
  "mode": "enterprise",
  "studioUpstream": "http://studio:3000",
  "callbackUrl": "${CALLBACK_URL:-http://localhost:8422/auth/callback}",
  "auth": [
    {
      "provider": "${AUTH_PROVIDER:-okta}",
      "issuer": "${AUTH_ISSUER:-https://dev-XXXXX.okta.com}",
      "clientId": "${AUTH_CLIENT_ID:-placeholder-client-id}",
      "clientSecret": "${AUTH_CLIENT_SECRET:-placeholder-client-secret}",
      "roleMapping": {
        "Engineering": "admin",
        "Support": "viewer",
        "default": "member"
      }
    }
  ],
  "roles": {
    "viewer": {
      "upstream": "http://openclaw-viewer:18789",
      "token": "${OPENCLAW_TOKEN_VIEWER}",
      "tools": ["read", "web_fetch"],
      "description": "Read-only access with web browsing"
    },
    "member": {
      "upstream": "http://openclaw-member:18790",
      "token": "${OPENCLAW_TOKEN_MEMBER}",
      "tools": ["read", "write", "edit", "exec"],
      "description": "Standard development access"
    },
    "admin": {
      "upstream": "http://openclaw-admin:18791",
      "token": "${OPENCLAW_TOKEN_ADMIN}",
      "tools": [],
      "description": "Full access with elevated permissions"
    }
  },
  "admins": ["${ADMIN_EMAIL:-admin@example.com}"]
}
GWEOF
  echo "[init] Created ${GATEWAY_CONFIG}"
else
  echo "[init] ${GATEWAY_CONFIG} already exists, skipping"
fi

# --- Write OpenClaw profile configs (idempotent) ---
write_profile() {
  local name="$1"
  local config_path="${OPENCLAW_DIR}/openclaw-${name}.json"

  if [ ! -f "${config_path}" ]; then
    cat > "${config_path}" << PROFEOF
{
  "auth": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY:-}"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${DEFAULT_MODEL:-anthropic/claude-sonnet-4-5}"
      }
    }
  }
}
PROFEOF
    echo "[init] Created ${config_path}"
  else
    echo "[init] ${config_path} already exists, skipping"
  fi
}

write_profile "viewer"
write_profile "member"
write_profile "admin"

# --- Write Studio settings (idempotent) ---
STUDIO_SETTINGS="${STUDIO_DIR}/settings.json"
if [ ! -f "${STUDIO_SETTINGS}" ]; then
  cat > "${STUDIO_SETTINGS}" << STEOF
{
  "gatewayUrl": "http://openclaw-admin:18791",
  "gatewayToken": "${OPENCLAW_TOKEN_ADMIN}"
}
STEOF
  echo "[init] Created ${STUDIO_SETTINGS}"
else
  echo "[init] ${STUDIO_SETTINGS} already exists, skipping"
fi

# --- Volume permissions (future-proof for non-root) ---
chown -R 1000:1000 "${DATA_DIR}" "${OPENCLAW_DIR}" 2>/dev/null || true

echo "[init] Initialization complete"
