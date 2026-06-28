# Deployment Scripts

Cloud-specific deployment scripts for AgentShield and AgentShield Dashboard.

## Directory Structure

```
deploy/
├── README.md                 ← This file
├── gcp/                      ← Google Cloud Platform
│   ├── README.md             ← GCP-specific instructions
│   ├── 01-setup-project.sh   ← Create GCP project & enable APIs
│   ├── 02-create-infra.sh    ← Cloud SQL, Memorystore, VPC connector
│   ├── 03-create-secrets.sh  ← Secret Manager
│   ├── 04-deploy-backend.sh  ← Build & deploy AgentShield to Cloud Run
│   ├── 05-deploy-dashboard.sh← Build & deploy dashboard
│   ├── 06-deploy-agents.sh   ← Build & deploy test agents
│   ├── 07-register-agents.sh ← Register test agents in AgentShield
│   ├── 08-run-tests.sh       ← Execute POC validation tests
│   ├── 09-teardown.sh        ← Destroy all resources
│   ├── config.env.template   ← Project-specific variables
│   └── agents/               ← Test agent source code
│       ├── echo-agent/
│       ├── finance-agent/
│       ├── support-agent/
│       ├── code-review-mcp/
│       └── weather-mcp/
├── aws/                      ← Amazon Web Services (planned)
│   └── README.md
└── azure/                    ← Microsoft Azure (planned)
    └── README.md
```

## Quick Start (GCP)

```bash
cd deploy/gcp
cp config.env.template config.env
# Edit config.env with your project details
./01-setup-project.sh
./02-create-infra.sh
./03-create-secrets.sh
./04-deploy-backend.sh
./05-deploy-dashboard.sh
./06-deploy-agents.sh
./07-register-agents.sh
./08-run-tests.sh
```

## Code Changes for Deployment

The application code is deployment-ready with one adjustment:

- **Dashboard `API_BASE`**: The dashboard's `src/api.js` uses `VITE_API_BASE` environment variable for the API URL. Set this during build:
  ```bash
  VITE_API_BASE=https://your-api-url.run.app/api/v1 npm run build
  ```

No backend code changes are required — all configuration is via environment variables.
