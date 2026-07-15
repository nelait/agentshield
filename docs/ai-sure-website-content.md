# AI Sure — Product Website Content

> **Brand**: AI Sure  
> **Tagline**: Govern Your AI Agents. Comply with Confidence.  
> **Date**: July 2026

---

## 🏠 HERO SECTION

### Headline
**Govern Your AI Agents. Comply with Confidence.**

### Subheadline
AI Sure is the enterprise governance firewall for AI agents. Control access, enforce policies, ensure compliance, and monitor every interaction — without touching a single line of agent code.

### CTA Buttons
- **Request a Demo** (primary)
- **View Documentation** (secondary)

### Hero Stats Bar
- **100%** Audit Coverage
- **<50ms** Governance Overhead
- **SOX · HIPAA · GDPR · PCI-DSS** Compliance Ready
- **REST · MCP · A2A · gRPC** Protocol Support

---

## 🔥 PROBLEM STATEMENT SECTION

### Section Title
**The AI Agent Governance Gap**

### Copy
Enterprises are deploying AI agents at an unprecedented pace — internal chatbots, customer-facing copilots, autonomous workflows, and third-party AI services. But governance hasn't kept up.

### Pain Points (3-column grid)

**🔓 No Unified Control Plane**
Your agents are scattered across vendors — OpenAI, Anthropic, Google, internal services. There's no single place to see, manage, or control what they do.

**📋 Compliance Is Manual**
SOX auditors ask for proof of AI oversight. HIPAA requires PHI controls. Today, you're stitching together spreadsheets and logs. Regulatory frameworks demand more.

**🚨 Blind Spots Everywhere**
Who called which agent? What data was sent? Was it authorized? Without immutable audit trails and policy enforcement, you're flying blind in a regulated world.

---

## ✨ FEATURES SECTION

### Section Title
**Everything You Need to Govern AI at Scale**

---

### Feature 1: Agent Registry
**One Catalog for Every Agent**

Register, organize, and manage all your AI agents in a single, vendor-neutral registry — regardless of protocol or provider.

- **Multi-protocol**: REST, MCP (Model Context Protocol), A2A, gRPC
- **Multi-vendor**: OpenAI, Anthropic, Google, AWS, internal services
- **Health monitoring**: Real-time status with automatic health checks
- **Metadata**: Version, owner, department, tags, and custom fields

---

### Feature 2: Policy Engine
**Fine-Grained Access Control with OPA/Rego**

Define who can use which agents, when, and how — using declarative policies that enforce in real time. Now with open-standard **OPA/Rego** support for policy-as-code workflows.

- **Role-based**: Allow/deny by user role, email, or department
- **Resource-scoped**: Target specific agents, tools, or workflows
- **Default deny**: Secure by default — only explicitly allowed actions pass
- **OPA/Rego support**: Policies auto-compile to OPA Rego — export, version in Git, and share across tools
- **Policy Playground**: Test policies against simulated user contexts before deploying

---

### Feature 3: Guardrails
**Protect Every Interaction**

Apply input/output guardrails to prevent sensitive data leakage, prompt injection, and policy violations at the request boundary.

- **Regex-based blocking**: PII, SSN, credit card, PHI detection
- **Custom patterns**: Define your own industry-specific rules
- **Per-agent profiles**: Different guardrail profiles for different agents
- **Real-time enforcement**: Block before the request reaches the agent

---

### Feature 4: Compliance Engine
**Regulatory Compliance, Automated — Now with NIST OSCAL**

Validate agent behavior against SOX, HIPAA, GDPR, and PCI-DSS frameworks with automated sampling, real-agent invocation, and dual-layer input/output scanning. Import industry-standard **NIST OSCAL** compliance catalogs and export machine-readable assessment results.

- **Framework-specific tests**: Auto-generated compliance scenarios per framework
- **OSCAL catalog import**: Upload NIST OSCAL JSON to import 100+ controls per framework
- **OSCAL assessment export**: Generate OSCAL Assessment Results for auditor-ready reports
- **Real invocation mode**: Test against live agents with actual payloads
- **Dual-layer validation**: Scans both inputs and outputs for violations
- **Custom samples**: Upload your own test cases for industry-specific validation
- **Audit reports**: Exportable compliance reports with PASS/FAIL/PARTIAL results

**Supported Frameworks:**

| Framework | Focus Areas | OSCAL Import |
|-----------|-------------|:------------:|
| **SOX** | Financial reporting, ledger modifications, payment processing | ✅ |
| **HIPAA** | PHI protection, patient records, medical data handling | ✅ |
| **GDPR** | Data erasure, consent management, marketing analytics | ✅ |
| **PCI-DSS** | Payment processing, card storage, transaction security | ✅ |
| **NIST 800-53** | Federal information security controls | ✅ |
| **FedRAMP** | Cloud service provider authorization | ✅ |

---

### Feature 5: Agent Evaluation
**Behavioral Assessment Beyond "Did It Answer Correctly?"**

A three-layer evaluation framework that analyzes how agents think, what they deliver, and what they cost — using LLM-as-a-Judge with Chain-of-Thought reasoning.

**Layer 1: Node-Level (The "How")**
- Tool selection accuracy
- Parameter precision
- Plan utility & reasoning coherence

**Layer 2: Session-Level (The "What")**
- Task success rate
- Topic adherence
- Grounding & faithfulness (hallucination detection)

**Layer 3: System-Level (The "Cost")**
- Token efficiency
- Step count optimization
- Latency-per-step profiling

**Advanced Capabilities:**
- **Persona-driven simulation**: Happy path, confused, adversarial, edge case, data-heavy
- **Golden Set validation**: Detect regressions automatically
- **Human-in-the-Loop (HITL)**: Low-confidence verdicts routed for human review
- **Configurable scoring**: Tunable weights, thresholds, and safety patterns

---

### Feature 6: Immutable Audit Trail
**Every Interaction. Every Decision. Forever.**

A compliance-grade, append-only audit log that captures every governance decision, agent interaction, and policy evaluation with full searchability.

- **Immutable records**: Cannot be modified or deleted after creation
- **Full context**: Actor, agent, action, decision, metadata, timestamps
- **Advanced search**: Filter by date range, agent, user, outcome, event type
- **Regulatory retention**: Configurable retention periods (up to 6+ years for SOX)
- **Export-ready**: Download audit data for external compliance tools

---

### Feature 7: Cost Management
**Control AI Spending Before It Spirals**

Set token-based and cost-based budgets per user, team, project, or agent — with real-time tracking and automatic enforcement.

- **Budget limits**: Per-user, per-team, per-project caps
- **Token tracking**: Input and output tokens measured per interaction
- **Usage analytics**: Historical trends and cost breakdowns
- **Threshold alerts**: Notifications before budgets are exhausted
- **Automatic enforcement**: Requests blocked when limits are exceeded

---

### Feature 8: Workflow Orchestration
**Chain Agents Into Governed Pipelines**

Combine multiple agents into multi-step workflows with numbered execution order, data flow rules, and governance at every step.

- **Sequential execution**: Define step order and data dependencies
- **Per-step governance**: Policies and guardrails apply to each agent individually
- **Multi-vendor chains**: Mix agents from different providers in one workflow
- **Visual management**: Configure and monitor workflows from the dashboard

---

### Feature 9: MCP Gateway
**Native Model Context Protocol Support**

First-class support for the MCP standard — register MCP agents, proxy MCP traffic with full governance, and test tools interactively.

- **MCP Proxy**: Transparent JSON-RPC proxy at `/mcp/:agentSlug`
- **Tool discovery**: Auto-discover and browse agent tools and schemas
- **MCP Explorer**: Built-in dashboard UI for interactive tool testing
- **Claude Desktop support**: Stdio-to-HTTP bridge for native integration
- **MCP Inspector compatible**: Works with the official MCP debugging tool

---

## 🏗️ HOW IT WORKS SECTION

### Section Title
**Zero-Interference Governance in Three Steps**

### Step 1: Register
Register your AI agents in the AI Sure catalog. Point us to their endpoint — REST, MCP, A2A, or gRPC. No agent code changes required.

### Step 2: Define
Set access policies, guardrail profiles, compliance frameworks, and budget limits through the admin dashboard. Test everything in the sandbox before going live.

### Step 3: Enforce
Route traffic through the AI Sure gateway. Every request is authenticated, authorized, scanned, audited, and metered — in under 50ms.

### Architecture Diagram (for website visual)
```
┌──────────────────────────────────────────────────┐
│              YOUR APPLICATIONS                    │
│  Chat UIs · Copilots · Automation · Agent Chains  │
└─────────────────────┬────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│               AI SURE GATEWAY                     │
│                                                    │
│   🔐 Auth    📋 Policy    🛡️ Guard    💰 Budget   │
│   📊 Audit   ⚖️ Comply    🧪 Eval     📈 Monitor  │
│                                                    │
└──────┬──────────┬──────────┬──────────┬──────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ OpenAI │ │Anthropic│ │ Google │ │Internal│
   │ Agents │ │ Agents  │ │ Agents │ │ Agents │
   └────────┘ └────────┘ └────────┘ └────────┘
```

---

## 🎯 USE CASES SECTION

### Section Title
**Built for Teams That Take AI Governance Seriously**

---

**🏦 Financial Services**
Enforce SOX compliance on AI agents that process financial data. Audit every interaction. Set cost controls per trading desk.

**🏥 Healthcare**
HIPAA-grade guardrails for patient-facing AI copilots. Detect PHI in agent inputs/outputs before violations occur.

**⚖️ Legal & Compliance**
Immutable audit trails that satisfy regulatory auditors. Prove who accessed what, when, and why — across every agent.

**🏢 Enterprise IT**
A single control plane for dozens of AI agents across teams. Role-based access, department-scoped budgets, vendor-neutral management.

**🔬 AI/ML Engineering**
Evaluate agent performance with three-layer behavioral analysis. Catch regressions. Benchmark across models and providers.

---

## 🔌 INTEGRATIONS SECTION

### Section Title
**Works With What You Already Use**

### Protocols
- REST / HTTP
- Model Context Protocol (MCP)
- Agent-to-Agent (A2A)
- gRPC

### Providers
- OpenAI (GPT-4o, GPT-4, GPT-3.5)
- Anthropic (Claude 3.5, Claude 3)
- Google (Gemini)
- AWS Bedrock
- Azure OpenAI
- Custom / Internal Services

### Clients
- Claude Desktop (via stdio bridge)
- MCP Inspector
- Postman / curl
- Python SDK
- Any HTTP client

### Infrastructure
- Google Cloud Run
- PostgreSQL
- Firebase Hosting
- Docker / Kubernetes

---

## 📊 COMPARISON SECTION

### Section Title
**How AI Sure Compares**

| Capability | API Gateways (Kong, Apigee) | Observability (LangSmith) | Guardrails (NeMo) | **AI Sure** |
|---|---|---|---|---|
| Agent Registry | ❌ | ❌ | ❌ | ✅ |
| Multi-Protocol (MCP/A2A) | ❌ | ❌ | ❌ | ✅ |
| Policy Engine | Partial | ❌ | ❌ | ✅ |
| Compliance (SOX/HIPAA) | ❌ | ❌ | ❌ | ✅ |
| Agent Evaluation | ❌ | Partial | ❌ | ✅ |
| Guardrails | ❌ | ❌ | ✅ | ✅ |
| Audit Trail | Partial | Partial | ❌ | ✅ |
| Cost Controls | ❌ | ❌ | ❌ | ✅ |
| Zero Code Changes | ✅ | ❌ | ❌ | ✅ |

---

## 💬 SOCIAL PROOF / STATS SECTION

### Section Title
**Trusted by Teams Building with AI**

- **8+** governance capabilities in one platform
- **4** regulatory frameworks supported out of the box
- **5** agent protocols supported (REST, MCP, A2A, gRPC, HTTP)
- **<50ms** governance overhead per request
- **3-layer** behavioral evaluation framework
- **100%** immutable audit coverage

---

## 🛡️ SECURITY SECTION

### Section Title
**Enterprise-Grade Security, Built In**

- **Encryption**: AES-256 for compliance data, TLS 1.3 in transit
- **Authentication**: JWT + API Key with role-based access (RBAC)
- **Immutable Logs**: Append-only audit trail — no modifications, no deletions
- **Zero Trust**: Default-deny policy engine — nothing passes without explicit authorization
- **Data Residency**: Deploy in your own cloud (GCP, AWS, Azure) for full data control
- **SOC 2 Ready**: Architecture designed for SOC 2 Type II certification

---

## 📐 DEPLOYMENT OPTIONS SECTION

### Section Title
**Deploy Your Way**

**☁️ Cloud Hosted**
Fully managed on Google Cloud. Up and running in minutes. No infrastructure to manage.

**🏠 Self-Hosted**
Deploy in your own VPC on GCP, AWS, or Azure. Full data sovereignty. Docker + Kubernetes supported.

**🔀 Hybrid**
Gateway in your VPC, dashboard in the cloud. Best of both worlds for security-conscious teams.

---

## 💰 PRICING SECTION

### Section Title
**Simple, Transparent Pricing**

**Starter** — Free
- Up to 5 agents
- 10,000 governed requests/month
- Basic policy engine
- Community support

**Professional** — $499/mo
- Up to 50 agents
- 500,000 governed requests/month
- Full compliance engine (SOX, HIPAA, GDPR, PCI-DSS)
- Agent evaluation & simulation
- Email support

**Enterprise** — Custom
- Unlimited agents
- Unlimited requests
- Self-hosted deployment
- Custom compliance frameworks
- Dedicated support & SLA
- SSO / SAML integration

---

## 📬 CTA / FOOTER SECTION

### Final CTA Block

**Ready to Govern Your AI Agents?**

AI Sure gives your team the confidence to deploy AI at scale — with the controls, compliance, and visibility your organization demands.

- **Request a Demo** (primary button)
- **Read the Docs** (secondary link)
- **Talk to Sales** (tertiary link)

### Footer Links

**Product**: Features · Pricing · Documentation · API Reference · Changelog  
**Company**: About · Blog · Careers · Contact  
**Legal**: Privacy Policy · Terms of Service · Security · SOC 2  
**Community**: GitHub · Discord · Twitter · LinkedIn

---

## 📝 SEO META TAGS

```html
<title>AI Sure — AI Agent Governance Firewall | Policy, Compliance, Audit</title>
<meta name="description" content="AI Sure is the enterprise governance firewall for AI agents. Enforce access policies, ensure SOX/HIPAA/GDPR compliance, and audit every interaction — without changing agent code." />
<meta name="keywords" content="AI governance, AI agent firewall, MCP proxy, SOX compliance AI, HIPAA AI agents, AI policy engine, agent registry, LLM guardrails, AI audit trail, Model Context Protocol, OPA Rego, NIST OSCAL, policy-as-code, compliance-as-code" />
<meta property="og:title" content="AI Sure — Govern Your AI Agents. Comply with Confidence." />
<meta property="og:description" content="Enterprise governance firewall for AI agents. Policy enforcement, compliance validation, and immutable audit trails for REST, MCP, A2A, and gRPC agents." />
<meta property="og:type" content="website" />
```

---

## 🎨 BRAND GUIDELINES

### Name Usage
- **Full name**: AI Sure
- **In sentences**: "AI Sure enforces governance..."
- **Never**: "AISure", "AI-Sure", "Ai Sure"

### Tagline Options
1. **Govern Your AI Agents. Comply with Confidence.** (primary)
2. **The Governance Firewall for AI Agents.** (short)
3. **Control. Comply. Confidence.** (ultra-short)
4. **Enterprise AI Governance, Simplified.** (formal)

### Suggested Color Palette
- **Primary**: `#6366F1` (Indigo 500) — Trust, intelligence
- **Accent**: `#10B981` (Emerald 500) — Safety, compliance
- **Danger**: `#EF4444` (Red 500) — Alerts, denials
- **Dark BG**: `#0F172A` (Slate 900) — Dashboard, premium feel
- **Text**: `#F8FAFC` (Slate 50) on dark / `#1E293B` (Slate 800) on light
