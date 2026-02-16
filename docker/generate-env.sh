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
# Edit this file before running: docker compose up --build -d

# --- Gateway ---
GATEWAY_PORT=8422
SESSION_SECRET=$(openssl rand -base64 32)
CALLBACK_URL=http://localhost:8422/auth/callback
NODE_ENV=production

# --- SSO Provider (configure at least one) ---
AUTH_PROVIDER=okta
AUTH_ISSUER=https://dev-XXXXX.okta.com
AUTH_CLIENT_ID=your-client-id
AUTH_CLIENT_SECRET=your-client-secret

# --- Admin ---
ADMIN_EMAIL=admin@example.com

# --- OpenClaw Gateway Tokens (auto-generated, rotate by regenerating .env) ---
OPENCLAW_TOKEN_VIEWER=$(openssl rand -hex 32)
OPENCLAW_TOKEN_MEMBER=$(openssl rand -hex 32)
OPENCLAW_TOKEN_ADMIN=$(openssl rand -hex 32)

# --- AI Provider ---
# Set your Anthropic API key here, or configure per-role via /admin dashboard
ANTHROPIC_API_KEY=
DEFAULT_MODEL=anthropic/claude-sonnet-4-5
EOF

echo "Created ${ENV_FILE}"
echo ""
echo "Next steps:"
echo "  1. Edit ${ENV_FILE} — set SSO credentials and API key"
echo "  2. docker compose up --build -d"
echo "  3. Visit http://localhost:8422"
