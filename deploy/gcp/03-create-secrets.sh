#!/usr/bin/env bash
# ============================================
# Step 3: Create Secrets in Secret Manager
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Secrets — Step 3"
echo "═══════════════════════════════════════════"

# Helper to create or update a secret
create_secret() {
    local name="$1"
    local value="$2"
    echo "→ Creating secret: $name"
    if gcloud secrets describe "$name" --project="$GCP_PROJECT_ID" &>/dev/null; then
        echo -n "$value" | gcloud secrets versions add "$name" --data-file=- --quiet
        echo "  (Updated existing secret)"
    else
        echo -n "$value" | gcloud secrets create "$name" --data-file=- --quiet
        echo "  (Created new secret)"
    fi
}

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
COMPLIANCE_KEY=$(openssl rand -base64 32 | head -c 32)

create_secret "agentshield-jwt-secret" "$JWT_SECRET"
create_secret "agentshield-db-password" "$DB_PASSWORD"
create_secret "agentshield-compliance-key" "$COMPLIANCE_KEY"

# Grant Cloud Run service account access
echo ""
echo "→ Granting Cloud Run access to secrets..."
PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in agentshield-jwt-secret agentshield-db-password agentshield-compliance-key; do
    gcloud secrets add-iam-policy-binding "$secret" \
        --member="serviceAccount:$SA" \
        --role="roles/secretmanager.secretAccessor" \
        --quiet 2>/dev/null || true
done

echo ""
echo "✅ Step 3 complete — Secrets stored in Secret Manager."
echo "→ Next: ./04-deploy-backend.sh"
