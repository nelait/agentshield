#!/usr/bin/env bash
# ============================================
# Step 4: Deploy AgentShield Backend to Cloud Run
#   - Build container image
#   - Deploy to Cloud Run
#   - Run database migrations
#   - Seed admin account
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

# Resolve paths
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTANCE_CONNECTION="${GCP_PROJECT_ID}:${GCP_REGION}:${DB_INSTANCE_NAME}"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Deploy Backend — Step 4"
echo "═══════════════════════════════════════════"
echo "  Source:  $BACKEND_DIR"
echo "  Service: $BACKEND_SERVICE_NAME"
echo ""

# Get Redis host
REDIS_HOST=$(gcloud redis instances describe "$REDIS_INSTANCE_NAME" \
    --region="$GCP_REGION" \
    --format='value(host)' 2>/dev/null || echo "")

if [ -z "$REDIS_HOST" ]; then
    echo "⚠️  Redis host not found. Skipping Redis config."
    echo "   You can add REDIS_HOST later via: gcloud run services update"
fi

# ── Deploy to Cloud Run ───────────────────────
echo "→ Deploying backend to Cloud Run (builds image automatically)..."
echo "  This will take 3-5 minutes on first deploy."
echo ""

gcloud run deploy "$BACKEND_SERVICE_NAME" \
    --source="$BACKEND_DIR" \
    --region="$GCP_REGION" \
    --add-cloudsql-instances="$INSTANCE_CONNECTION" \
    --vpc-connector="$VPC_CONNECTOR_NAME" \
    --set-env-vars="\
NODE_ENV=production,\
DB_HOST=/cloudsql/${INSTANCE_CONNECTION},\
DB_NAME=${DB_NAME},\
DB_USER=${DB_USER},\
DB_PORT=5432,\
DB_SSL=false,\
REDIS_HOST=${REDIS_HOST:-localhost},\
REDIS_PORT=6379,\
LOG_LEVEL=info,\
ADMIN_EMAIL=${ADMIN_EMAIL},\
ADMIN_PASSWORD=${ADMIN_PASSWORD},\
HEALTH_CHECK_INTERVAL_MS=30000,\
OTEL_SERVICE_NAME=agentshield" \
    --set-secrets="\
JWT_SECRET=agentshield-jwt-secret:latest,\
DB_PASSWORD=agentshield-db-password:latest,\
COMPLIANCE_ENCRYPTION_KEY=agentshield-compliance-key:latest" \
    --min-instances="$BACKEND_MIN_INSTANCES" \
    --max-instances="$BACKEND_MAX_INSTANCES" \
    --memory="$BACKEND_MEMORY" \
    --cpu="$BACKEND_CPU" \
    --port=3000 \
    --allow-unauthenticated \
    --quiet

# Get the deployed URL
BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE_NAME" \
    --region="$GCP_REGION" \
    --format='value(status.url)')

echo ""
echo "✅ Backend deployed: $BACKEND_URL"

# Save URL to config for other scripts
if grep -q "^BACKEND_URL=" "$SCRIPT_DIR/config.env"; then
    sed -i.bak "s|^BACKEND_URL=.*|BACKEND_URL=$BACKEND_URL|" "$SCRIPT_DIR/config.env"
    rm -f "$SCRIPT_DIR/config.env.bak"
else
    echo "BACKEND_URL=$BACKEND_URL" >> "$SCRIPT_DIR/config.env"
fi

# ── Run Migrations ────────────────────────────
echo ""
echo "→ Running database migrations..."

gcloud run jobs create agentshield-migrate \
    --image="$(gcloud run services describe "$BACKEND_SERVICE_NAME" \
        --region="$GCP_REGION" \
        --format='value(spec.template.spec.containers[0].image)')" \
    --region="$GCP_REGION" \
    --add-cloudsql-instances="$INSTANCE_CONNECTION" \
    --vpc-connector="$VPC_CONNECTOR_NAME" \
    --set-env-vars="\
DB_HOST=/cloudsql/${INSTANCE_CONNECTION},\
DB_NAME=${DB_NAME},\
DB_USER=${DB_USER},\
DB_SSL=false" \
    --set-secrets="DB_PASSWORD=agentshield-db-password:latest" \
    --command="npm" \
    --args="run,migrate" \
    --max-retries=0 \
    --quiet 2>/dev/null || true

gcloud run jobs execute agentshield-migrate \
    --region="$GCP_REGION" \
    --wait \
    --quiet

echo "✅ Migrations complete."

# ── Seed Admin Account ────────────────────────
echo "→ Seeding admin account..."

gcloud run jobs create agentshield-seed \
    --image="$(gcloud run services describe "$BACKEND_SERVICE_NAME" \
        --region="$GCP_REGION" \
        --format='value(spec.template.spec.containers[0].image)')" \
    --region="$GCP_REGION" \
    --add-cloudsql-instances="$INSTANCE_CONNECTION" \
    --vpc-connector="$VPC_CONNECTOR_NAME" \
    --set-env-vars="\
DB_HOST=/cloudsql/${INSTANCE_CONNECTION},\
DB_NAME=${DB_NAME},\
DB_USER=${DB_USER},\
DB_SSL=false,\
ADMIN_EMAIL=${ADMIN_EMAIL},\
ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
    --set-secrets="\
DB_PASSWORD=agentshield-db-password:latest,\
JWT_SECRET=agentshield-jwt-secret:latest" \
    --command="npm" \
    --args="run,seed" \
    --max-retries=0 \
    --quiet 2>/dev/null || true

gcloud run jobs execute agentshield-seed \
    --region="$GCP_REGION" \
    --wait \
    --quiet

echo "✅ Admin account seeded."

# ── Verify ────────────────────────────────────
echo ""
echo "→ Verifying deployment..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Health check passed (HTTP $HTTP_STATUS)"
else
    echo "⚠️  Health check returned HTTP $HTTP_STATUS"
    echo "   The service may still be starting. Try: curl ${BACKEND_URL}/health"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Step 4 complete"
echo "═══════════════════════════════════════════"
echo "  Backend URL: $BACKEND_URL"
echo "  API Base:    ${BACKEND_URL}/api/v1"
echo ""
echo "→ Next: ./05-deploy-dashboard.sh"
