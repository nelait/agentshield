#!/usr/bin/env bash
# ============================================
# Step 2: Create Infrastructure
#   - Cloud SQL PostgreSQL
#   - Memorystore Redis
#   - VPC Connector
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Infra — Step 2"
echo "═══════════════════════════════════════════"

# ── Cloud SQL PostgreSQL ──────────────────────
echo ""
echo "→ Creating Cloud SQL PostgreSQL instance: $DB_INSTANCE_NAME ..."
echo "  (This takes 5-10 minutes)"

# Auto-generate password if not set
if [ -z "${DB_PASSWORD:-}" ]; then
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    echo "→ Generated DB password (save this!): $DB_PASSWORD"
    # Update config.env with the generated password
    if grep -q "^DB_PASSWORD=$" "$SCRIPT_DIR/config.env"; then
        sed -i.bak "s|^DB_PASSWORD=$|DB_PASSWORD=$DB_PASSWORD|" "$SCRIPT_DIR/config.env"
        rm -f "$SCRIPT_DIR/config.env.bak"
    fi
fi

gcloud sql instances create "$DB_INSTANCE_NAME" \
    --database-version=POSTGRES_16 \
    --tier=db-custom-1-3840 \
    --region="$GCP_REGION" \
    --storage-size=10GB \
    --storage-type=SSD \
    --availability-type=zonal \
    --no-assign-ip \
    --network=default \
    --quiet || echo "  (Instance may already exist)"

echo "→ Creating database..."
gcloud sql databases create "$DB_NAME" \
    --instance="$DB_INSTANCE_NAME" \
    --quiet 2>/dev/null || echo "  (Database may already exist)"

echo "→ Creating database user..."
gcloud sql users create "$DB_USER" \
    --instance="$DB_INSTANCE_NAME" \
    --password="$DB_PASSWORD" \
    --quiet 2>/dev/null || echo "  (User may already exist)"

# ── Memorystore Redis ─────────────────────────
echo ""
echo "→ Creating Memorystore Redis: $REDIS_INSTANCE_NAME ..."
echo "  (This takes 3-5 minutes)"

gcloud redis instances create "$REDIS_INSTANCE_NAME" \
    --size="${REDIS_SIZE_GB}" \
    --region="$GCP_REGION" \
    --redis-version=redis_7_0 \
    --quiet || echo "  (Redis instance may already exist)"

# Get Redis host IP
REDIS_HOST=$(gcloud redis instances describe "$REDIS_INSTANCE_NAME" \
    --region="$GCP_REGION" \
    --format='value(host)' 2>/dev/null || echo "pending")
echo "→ Redis host: $REDIS_HOST"

# ── VPC Connector ─────────────────────────────
echo ""
echo "→ Creating Serverless VPC Access connector: $VPC_CONNECTOR_NAME ..."

gcloud compute networks vpc-access connectors create "$VPC_CONNECTOR_NAME" \
    --region="$GCP_REGION" \
    --range="$VPC_CONNECTOR_RANGE" \
    --quiet 2>/dev/null || echo "  (Connector may already exist)"

# ── Summary ───────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Step 2 complete — Infrastructure created"
echo "═══════════════════════════════════════════"
echo "  Cloud SQL:  $DB_INSTANCE_NAME (PostgreSQL 16)"
echo "  Redis:      $REDIS_HOST"
echo "  VPC:        $VPC_CONNECTOR_NAME"
echo ""
echo "→ Next: ./03-create-secrets.sh"
