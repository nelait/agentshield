#!/usr/bin/env bash
# ============================================
# Step 9: Teardown — Destroy all GCP resources
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Teardown — Step 9"
echo "  ⚠️  This will DELETE all resources!"
echo "═══════════════════════════════════════════"

read -p "Are you sure? Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""

# Delete Cloud Run services
echo "→ Deleting Cloud Run services..."
for svc in agentshield-api echo-agent finance-agent support-agent weather-mcp; do
    gcloud run services delete "$svc" --region="$GCP_REGION" --quiet 2>/dev/null && \
        echo "  Deleted: $svc" || echo "  (not found: $svc)"
done

# Delete Cloud Run jobs
echo "→ Deleting Cloud Run jobs..."
for job in agentshield-migrate agentshield-seed; do
    gcloud run jobs delete "$job" --region="$GCP_REGION" --quiet 2>/dev/null && \
        echo "  Deleted: $job" || echo "  (not found: $job)"
done

# Delete secrets
echo "→ Deleting secrets..."
for secret in agentshield-jwt-secret agentshield-db-password agentshield-compliance-key; do
    gcloud secrets delete "$secret" --quiet 2>/dev/null && \
        echo "  Deleted: $secret" || echo "  (not found: $secret)"
done

# Delete Redis
echo "→ Deleting Memorystore Redis..."
gcloud redis instances delete "$REDIS_INSTANCE_NAME" \
    --region="$GCP_REGION" --quiet 2>/dev/null && \
    echo "  Deleted: $REDIS_INSTANCE_NAME" || echo "  (not found)"

# Delete VPC Connector
echo "→ Deleting VPC connector..."
gcloud compute networks vpc-access connectors delete "$VPC_CONNECTOR_NAME" \
    --region="$GCP_REGION" --quiet 2>/dev/null && \
    echo "  Deleted: $VPC_CONNECTOR_NAME" || echo "  (not found)"

# Delete Cloud SQL (most expensive — delete last)
echo "→ Deleting Cloud SQL instance..."
echo "  (This takes 2-5 minutes)"
gcloud sql instances delete "$DB_INSTANCE_NAME" --quiet 2>/dev/null && \
    echo "  Deleted: $DB_INSTANCE_NAME" || echo "  (not found)"

# Clean up local files
rm -f "$SCRIPT_DIR/.agent-urls"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Teardown complete"
echo "═══════════════════════════════════════════"
echo "  All GCP resources have been deleted."
echo "  Firebase Hosting must be deleted separately:"
echo "  npx -y firebase-tools hosting:disable --project $GCP_PROJECT_ID"
