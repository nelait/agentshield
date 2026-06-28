# AgentShield — Azure Deployment

> 🚧 **Planned** — Scripts will follow the same structure as the GCP deployment.

## Target Architecture

- **Compute**: Azure Container Apps
- **Database**: Azure Database for PostgreSQL (Flexible Server)
- **Cache**: Azure Cache for Redis
- **Dashboard**: Azure Static Web Apps (free tier)
- **Secrets**: Azure Key Vault
- **Registry**: Azure Container Registry

## Reference

See the full deployment guide at:
`docs/analysis/poc-deployment-azure.html`

## Planned Scripts

```
azure/
├── 01-setup-resources.sh
├── 02-create-infra.sh        # PostgreSQL, Redis
├── 03-create-secrets.sh      # Key Vault
├── 04-deploy-backend.sh      # Container Apps
├── 05-deploy-dashboard.sh    # Static Web Apps
├── 06-deploy-agents.sh       # Container Apps (scale-to-zero)
├── 07-register-agents.sh
├── 08-run-tests.sh
├── 09-teardown.sh
├── config.env.template
└── agents/                   # Same agent source as GCP
```

## Estimated Cost

~$84–$91/month (lowest cost — see deployment guide for breakdown)
