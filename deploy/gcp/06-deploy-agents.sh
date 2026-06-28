#!/usr/bin/env bash
# ============================================
# Step 6: Deploy Test Agents to Cloud Run
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

AGENTS_DIR="$SCRIPT_DIR/agents"
AGENTS=("echo-agent" "finance-agent" "support-agent" "weather-mcp")

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Deploy Agents — Step 6"
echo "  Deploying ${#AGENTS[@]} test agents"
echo "═══════════════════════════════════════════"

AGENT_URLS=""

for agent in "${AGENTS[@]}"; do
    echo ""
    echo "────────────────────────────────────────"
    echo "→ Deploying: $agent"
    echo "────────────────────────────────────────"

    if [ ! -d "$AGENTS_DIR/$agent" ]; then
        echo "  ⚠️  Directory not found: $AGENTS_DIR/$agent — skipping"
        continue
    fi

    gcloud run deploy "$agent" \
        --source="$AGENTS_DIR/$agent" \
        --region="$GCP_REGION" \
        --memory=256Mi \
        --cpu=0.5 \
        --min-instances=0 \
        --max-instances=2 \
        --port=8080 \
        --allow-unauthenticated \
        --quiet

    AGENT_URL=$(gcloud run services describe "$agent" \
        --region="$GCP_REGION" \
        --format='value(status.url)')

    echo "  ✅ $agent → $AGENT_URL"
    AGENT_URLS="${AGENT_URLS}${agent}=${AGENT_URL}\n"
done

# Save agent URLs for registration script
echo ""
echo "→ Saving agent URLs..."
echo -e "$AGENT_URLS" > "$SCRIPT_DIR/.agent-urls"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Step 6 complete — All agents deployed"
echo "═══════════════════════════════════════════"
cat "$SCRIPT_DIR/.agent-urls"
echo ""
echo "→ Next: ./07-register-agents.sh"
