#!/bin/sh
# Generates .env file with random tokens for Docker Compose
# Run once before first deploy: ./docker/generate-env.sh

set -e

ENV_FILE="${1:-.env}"

if [ -f "${ENV_FILE}" ]; then
  echo "WARNING: ${ENV_FILE} already exists. Delete it first to regenerate."
  echo "  rm ${ENV_FILE} && ./docker/generate-env.sh"
  exit 1
fi

echo "Generating ${ENV_FILE}..."

cat > "${ENV_FILE}" << EOF
# ClawGateway Docker Compose Environment
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- Gateway ---
GATEWAY_PORT=8422
SESSION_SECRET=$(openssl rand -base64 32)
EXTERNAL_URL=http://localhost:8422
GATEWAY_WS_URL=ws://localhost:8422/api/gateway/ws

# --- SSO (placeholder until you add real creds) ---
AUTH_CLIENT_ID=placeholder
AUTH_CLIENT_SECRET=placeholder

# --- OpenClaw Token (shared between gateway + openclaw instance) ---
OPENCLAW_TOKEN=$(openssl rand -hex 32)

# --- AI Provider ---
ANTHROPIC_API_KEY=sk-ant-placeholder-set-in-admin-later
EOF

echo "Created ${ENV_FILE}"
echo ""
echo "Next steps:"
echo "  1. Edit ${ENV_FILE} — set EXTERNAL_URL and ANTHROPIC_API_KEY"
echo "  2. docker compose up --build -d"
echo "  3. Visit http://localhost:8422"
