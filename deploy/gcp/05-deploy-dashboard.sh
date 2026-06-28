#!/usr/bin/env bash
# ============================================
# Step 5: Deploy Dashboard
#   - Build React app with API URL
#   - Deploy to Firebase Hosting (free tier)
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

# Dashboard source is a sibling directory
DASHBOARD_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)/agentshield-dashboard"

echo "═══════════════════════════════════════════"
echo "  AgentShield GCP Deploy Dashboard — Step 5"
echo "═══════════════════════════════════════════"

if [ ! -d "$DASHBOARD_DIR" ]; then
    echo "❌ Dashboard directory not found at: $DASHBOARD_DIR"
    echo "   Expected agentshield-dashboard to be a sibling of agentshield."
    exit 1
fi

if [ -z "${BACKEND_URL:-}" ]; then
    echo "❌ BACKEND_URL not set in config.env."
    echo "   Run ./04-deploy-backend.sh first."
    exit 1
fi

echo "  Dashboard: $DASHBOARD_DIR"
echo "  API URL:   ${BACKEND_URL}/api/v1"
echo ""

# ── Build Dashboard ───────────────────────────
echo "→ Building dashboard with production API URL..."
cd "$DASHBOARD_DIR"

# Build with the production API URL
VITE_API_BASE="${BACKEND_URL}/api/v1" npm run build

echo "✅ Dashboard built."

# ── Deploy to Firebase Hosting ────────────────
echo ""
echo "→ Deploying to Firebase Hosting..."

# Check if Firebase is initialized
if [ ! -f "firebase.json" ]; then
    echo "→ Initializing Firebase Hosting..."
    cat > firebase.json << 'FIREBASE_JSON'
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css|map)",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      },
      {
        "source": "index.html",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
        ]
      }
    ]
  }
}
FIREBASE_JSON
    echo "  Created firebase.json"
fi

if [ ! -f ".firebaserc" ]; then
    cat > .firebaserc << FIREBASERC
{
  "projects": {
    "default": "${DASHBOARD_PROJECT_ID}"
  }
}
FIREBASERC
    echo "  Created .firebaserc"
fi

# Deploy
npx -y firebase-tools deploy --only hosting --project "$DASHBOARD_PROJECT_ID"

# Get the hosting URL
DASHBOARD_URL="https://${DASHBOARD_PROJECT_ID}.web.app"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Step 5 complete"
echo "═══════════════════════════════════════════"
echo "  Dashboard:  $DASHBOARD_URL"
echo "  Backend:    $BACKEND_URL"
echo ""
echo "→ Next: ./06-deploy-agents.sh"
