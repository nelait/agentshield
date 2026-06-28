#!/usr/bin/env bash
# ============================================
# Step 7: Register Test Agents in AgentShield
#   - Login to get JWT
#   - Register each agent with its Cloud Run URL
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

API="${BACKEND_URL}/api/v1"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Register Agents — Step 7"
echo "  API: $API"
echo "═══════════════════════════════════════════"

# Load agent URLs
if [ ! -f "$SCRIPT_DIR/.agent-urls" ]; then
    echo "❌ Agent URLs file not found. Run ./06-deploy-agents.sh first."
    exit 1
fi

# Helper to get agent URL
get_url() {
    grep "^$1=" "$SCRIPT_DIR/.agent-urls" | cut -d= -f2-
}

# ── Login ─────────────────────────────────────
echo "→ Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -X POST "${API}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed. Response:"
    echo "$LOGIN_RESPONSE"
    exit 1
fi
echo "  ✅ Logged in."

# ── Register Agents ──────────────────────────
register_agent() {
    local name="$1" slug="$2" protocol="$3" url="$4" desc="$5"
    echo ""
    echo "→ Registering: $name ($protocol)"
    local RESPONSE=$(curl -s -X POST "${API}/admin/agents" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$name\",
            \"slug\": \"$slug\",
            \"type\": \"internal\",
            \"protocol\": \"$protocol\",
            \"endpointUrl\": \"$url\",
            \"description\": \"$desc\"
        }")
    local SUCCESS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null || echo "")
    if [ "$SUCCESS" = "True" ] || [ "$SUCCESS" = "true" ]; then
        echo "  ✅ Registered: $slug"
    else
        echo "  ⚠️  Response: $RESPONSE"
    fi
}

ECHO_URL=$(get_url echo-agent)
FINANCE_URL=$(get_url finance-agent)
SUPPORT_URL=$(get_url support-agent)
WEATHER_URL=$(get_url weather-mcp)

register_agent \
    "Echo Agent" "echo-agent" "rest" \
    "$ECHO_URL" "Baseline echo agent for policy/auth/audit testing"

register_agent \
    "Finance Agent" "finance-agent" "rest" \
    "$FINANCE_URL" "Financial analysis with token usage reporting"

register_agent \
    "Support Agent" "support-agent" "rest" \
    "$SUPPORT_URL" "Customer support agent (PII/guardrail test target)"

register_agent \
    "Weather MCP" "weather-mcp" "mcp" \
    "${WEATHER_URL}/mcp/sse" "Weather data tools via MCP protocol"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Step 7 complete — Agents registered"
echo "═══════════════════════════════════════════"
echo "→ Next: ./08-run-tests.sh"
