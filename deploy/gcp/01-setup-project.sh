#!/usr/bin/env bash
# ============================================
# Step 1: GCP Project Setup & API Enablement
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Setup — Step 1"
echo "  Project: $GCP_PROJECT_ID"
echo "  Region:  $GCP_REGION"
echo "═══════════════════════════════════════════"

# Set active project
echo "→ Setting active project..."
gcloud config set project "$GCP_PROJECT_ID" 2>/dev/null || {
    echo "→ Project does not exist. Creating..."
    gcloud projects create "$GCP_PROJECT_ID" --name="AgentShield POC"
    gcloud config set project "$GCP_PROJECT_ID"
}

# Set default region
gcloud config set run/region "$GCP_REGION"
gcloud config set compute/region "$GCP_REGION"

# Enable required APIs
echo "→ Enabling required APIs (this may take a minute)..."
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    cloudbuild.googleapis.com \
    vpcaccess.googleapis.com \
    compute.googleapis.com

echo ""
echo "✅ Step 1 complete — Project configured and APIs enabled."
echo "→ Next: ./02-create-infra.sh"
