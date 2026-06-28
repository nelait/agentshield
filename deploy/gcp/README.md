# AgentShield — GCP Deployment

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/install) (`gcloud` CLI)
- [Node.js 20+](https://nodejs.org/) (for building dashboard)
- [Firebase CLI](https://firebase.google.com/docs/cli) (auto-installed via `npx`)
- GCP billing account linked to the project

## Quick Start

```bash
# 1. Configure
cp config.env.template config.env
# Edit config.env with your GCP project ID

# 2. Make scripts executable
chmod +x *.sh

# 3. Run in order
./01-setup-project.sh       # Create project, enable APIs        (~1 min)
./02-create-infra.sh        # Cloud SQL, Redis, VPC connector    (~10 min)
./03-create-secrets.sh      # JWT, DB password, compliance key   (~1 min)
./04-deploy-backend.sh      # Build & deploy to Cloud Run        (~5 min)
./05-deploy-dashboard.sh    # Build React app, deploy Firebase   (~3 min)
./06-deploy-agents.sh       # Deploy 4 test agents               (~5 min)
./07-register-agents.sh     # Register agents in AgentShield     (~1 min)
./08-run-tests.sh           # Run POC validation tests           (~2 min)

# Total: ~30 minutes
```

## Code Changes Required

### Dashboard: API Base URL

The dashboard hardcodes `API_BASE` to `localhost:3000`. For cloud deployment, it reads from the Vite environment variable `VITE_API_BASE`. This is set automatically during the build step in `05-deploy-dashboard.sh`.

**File**: `agentshield-dashboard/src/api.js` — Line 1

```diff
- const API_BASE = 'http://localhost:3000/api/v1';
+ const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api/v1';
```

> This change is backwards-compatible: if `VITE_API_BASE` is not set, it falls back to localhost for local development.

### Backend: No Changes Required

The backend is fully configurable via environment variables. All values are set in the Cloud Run deployment command (Step 4).

## Estimated Cost

| Service | Monthly |
|---------|---------|
| Cloud Run (backend + agents) | ~$30 |
| Cloud SQL PostgreSQL | ~$30 |
| Memorystore Redis | ~$35 |
| Firebase Hosting | $0 |
| Secret Manager | ~$0.10 |
| **Total** | **~$95** |

## Cleanup

```bash
./09-teardown.sh  # Deletes ALL resources (requires confirmation)
```

## Test Agents

| Agent | Protocol | Purpose |
|-------|----------|---------|
| echo-agent | REST | Policy, auth, audit baseline |
| finance-agent | REST | Cost tracking, budget enforcement |
| support-agent | REST | Guardrails (PII, profanity) |
| weather-mcp | MCP | MCP protocol, workflow chaining |
