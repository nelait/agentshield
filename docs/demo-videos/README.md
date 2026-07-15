# AI Sure — Product Demo Videos & Screenshots

> Recorded from the live AI Sure dashboard at `https://agentshield-dashboard.web.app`  
> Date: July 9, 2026

---

## 🎬 Demo Videos (WebP Animated)

Three recorded walkthroughs of the live AI Sure admin dashboard, covering all major features.

### Video 1: Dashboard, Agent Registry, Workflows & Policies
**File**: `docs/demo-videos/01-dashboard-agents-workflows-policies.webp` (5.5 MB)

**Scenes covered:**
1. Login to the admin dashboard
2. **Dashboard Overview** — Health stats, activity charts, agent status summary
3. **Agent Registry** — List of registered AI agents with protocol, vendor, health status
4. **Agent Details** — Individual agent configuration, endpoint, auth, metadata
5. **Workflows** — Multi-step agent pipelines with step ordering
6. **Policies** — Allow/deny rules scoped by user role, email, department, and agent

---

### Video 2: Guardrails, Compliance, Audit Log & MCP Explorer
**File**: `docs/demo-videos/02-guardrails-compliance-audit-mcp-explorer.webp` (8.0 MB)

**Scenes covered:**
1. **Guardrails** — Regex-based input/output blocking profiles and rules
2. **Compliance** — SOX/HIPAA/GDPR/PCI-DSS framework configurations and checks
3. **Audit Log** — Immutable event trail with search, filters, and details
4. **Playground** — Agent testing sandbox
5. **🔌 MCP Explorer** — Live tool discovery, invocation, and governance check badges

---

### Video 3: Dashboard Deep Dive, Evaluations, Cost Management & Settings
**File**: `docs/demo-videos/03-dashboard-evaluations-cost-settings.webp` (13 MB)

**Scenes covered:**
1. **Dashboard Overview** — Charts and health indicators
2. **Agent Registry** — Agent list with protocols and health
3. **Agent Details** — Detailed view of a specific agent
4. **Evaluations** — Three-layer agent behavioral assessment (Node/Session/System)
5. **Reports** — Generated compliance and evaluation reports
6. **Cost Management** — Budgets, model pricing, and usage tracking
7. **Settings** — LLM connections, module toggles, API keys, evaluation config

---

## 📸 Screenshots

Key screenshots from the live dashboard for use in presentations, pitch decks, and marketing.

| Screenshot | Description | File |
|------------|-------------|------|
| Dashboard Overview | Main dashboard with health stats and charts | `screenshots/dashboard-overview.png` |
| Agent Registry | List of registered agents with protocols | `screenshots/agent-registry.png` |
| Agent Details | Individual agent config page | `screenshots/agent-details.png` |
| Cost Management | Overview tab with spending analytics | `screenshots/cost-management.png` |
| Budgets | Budget allocation by user/team/project | `screenshots/budgets.png` |
| Model Pricing | Token pricing configuration per model | `screenshots/model-pricing.png` |
| Reports | Generated compliance and evaluation reports | `screenshots/reports.png` |
| Settings - Modules | Feature toggles for each module | `screenshots/settings-modules.png` |
| Settings - API Keys | API key management for MCP/REST access | `screenshots/settings-api-keys.png` |

---

## 🎥 Usage Notes

### Viewing Videos
The demo videos are in **WebP animated format**. To view:
- **Browser**: Open the `.webp` file in any modern browser (Chrome, Firefox, Safari)
- **macOS Preview**: Supports animated WebP natively
- **VS Code**: Use the built-in image preview

### Converting to MP4
If you need MP4 format for embedding in presentations or social media:
```bash
# Using ffmpeg
ffmpeg -i 01-dashboard-agents-workflows-policies.webp -c:v libx264 -pix_fmt yuv420p demo-part1.mp4

# Or install webp tools
brew install webp
```

### Recommended Video Editing
For a polished product video with voiceover, music, and transitions:
1. Convert WebP → MP4 using ffmpeg
2. Import into video editor (iMovie, Final Cut, DaVinci Resolve)
3. Add AI Sure branding overlay
4. Add voiceover narration
5. Add background music
6. Export as 1080p MP4

---

## 📋 Suggested Narration Script

### Part 1 (0:00 - 0:30)
*"Welcome to AI Sure — the enterprise governance firewall for AI agents. Let's walk through the platform."*

*"This is the main dashboard. At a glance, you can see the health of all your registered agents, recent activity, and governance status across your organization."*

### Part 2 (0:30 - 1:00)
*"In the Agent Registry, every AI agent in your organization is cataloged — regardless of vendor or protocol. REST APIs, MCP servers, gRPC services — all managed from one place."*

*"Click into any agent to see its configuration, endpoint, authentication setup, and real-time health status."*

### Part 3 (1:00 - 1:30)
*"Policies let you control who can access which agents. Define allow and deny rules by user role, email, or department. AI Sure uses a default-deny model — nothing passes without explicit authorization."*

*"Guardrails add another layer of protection. Set up regex patterns to automatically block PII, SSN numbers, credit card data, or any sensitive information from reaching your agents."*

### Part 4 (1:30 - 2:00)
*"The Compliance Engine validates agent behavior against regulatory frameworks — SOX, HIPAA, GDPR, and PCI-DSS. Run automated checks with real agent invocations and get detailed pass/fail reports."*

*"Every interaction is captured in an immutable audit trail. Search by date, agent, user, or outcome. This is the evidence your compliance team and auditors need."*

### Part 5 (2:00 - 2:30)
*"The MCP Explorer lets you interactively test any MCP agent. Browse tools, fill in parameters, and invoke — all while seeing governance checks in real time. Green badges mean the request passed policy, guardrails, and status checks. Red means it was blocked."*

### Part 6 (2:30 - 3:00)
*"Finally, Cost Management tracks token usage and spending across all agents, with budget limits per user, team, or project. And the Evaluation module provides three-layer behavioral assessment — testing not just what agents say, but how they think."*

*"AI Sure. Govern your AI agents. Comply with confidence."*
