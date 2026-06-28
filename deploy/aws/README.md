# AgentShield — AWS Deployment

> 🚧 **Planned** — Scripts will follow the same structure as the GCP deployment.

## Target Architecture

- **Compute**: ECS Fargate
- **Database**: RDS PostgreSQL 16
- **Cache**: ElastiCache Redis
- **Dashboard**: S3 + CloudFront
- **Secrets**: AWS Secrets Manager
- **Load Balancer**: Application Load Balancer (ALB)

## Reference

See the full deployment guide at:
`docs/analysis/poc-deployment-aws.html`

## Planned Scripts

```
aws/
├── 01-setup-vpc.sh
├── 02-create-infra.sh        # RDS, ElastiCache, ALB
├── 03-create-secrets.sh      # Secrets Manager
├── 04-deploy-backend.sh      # ECS Fargate / Copilot
├── 05-deploy-dashboard.sh    # S3 + CloudFront
├── 06-deploy-agents.sh       # ECS Fargate tasks
├── 07-register-agents.sh
├── 08-run-tests.sh
├── 09-teardown.sh
├── config.env.template
└── agents/                   # Same agent source as GCP
```

## Estimated Cost

~$110–$118/month (see deployment guide for breakdown)
