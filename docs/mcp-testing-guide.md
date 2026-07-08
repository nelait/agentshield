# Testing MCP Agents with AgentShield — Complete Guide

> **Version**: 2.0  
> **Date**: July 2026  
> **Scope**: Launching MCP testing tools, configuring connections, testing registered agents, governance enforcement, and troubleshooting

---

## Table of Contents

1. [Overview — Testing Options](#1-overview--testing-options)
2. [MCP Inspector (Browser UI)](#2-mcp-inspector-browser-ui)
3. [Dashboard MCP Explorer (Built-in)](#3-dashboard-mcp-explorer-built-in)
4. [Claude Desktop Integration](#4-claude-desktop-integration)
5. [curl / Command Line Testing](#5-curl--command-line-testing)
6. [Python MCP Client](#6-python-mcp-client)
7. [Governance Enforcement — Two Paths](#7-governance-enforcement--two-paths)
8. [Issues Fixed During Implementation](#8-issues-fixed-during-implementation)
9. [Architecture Reference](#9-architecture-reference)

---

## 1. Overview — Testing Options

AgentShield provides three paths for accessing registered agents:

| Path | Protocol | URL Pattern | Auth |
|------|----------|-------------|------|
| **MCP Proxy** | Native MCP (JSON-RPC 2.0) | `/mcp/:agentSlug` | API Key (`X-API-Key`) |
| **REST Gateway** | HTTP POST → JSON | `/api/v1/gateway/agents/:slug/invoke` | JWT (`Authorization: Bearer`) |
| **Admin API** | HTTP POST → JSON | `/api/v1/playground/mcp-*` | JWT (`Authorization: Bearer`) |

Different testing tools use different paths:

| Testing Tool | Path Used | MCP Agents | REST Agents | Visual UI | Governance |
|-------------|-----------|-----------|-------------|-----------|------------|
| **MCP Inspector** | MCP Proxy | ✅ | ❌ | ✅ Browser | ✅ Full |
| **Dashboard MCP Explorer** | Admin API | ✅ | ❌ | ✅ Dashboard | ✅ Full |
| **Dashboard Playground** | REST Gateway | ✅ | ✅ | ✅ Dashboard | ✅ Full |
| **Claude Desktop** | MCP Proxy (via bridge) | ✅ | ❌ | ✅ Chat | ✅ Full |
| **curl / Postman** | Any | ✅ | ✅ | ❌ | ✅ Full |
| **Python MCP Client** | MCP Proxy | ✅ | ❌ | ❌ | ✅ Full |

> **Key point**: All paths enforce governance (policy, guardrails, audit). No path bypasses AgentShield.

---

## 2. MCP Inspector (Browser UI)

### What Is It?

The **MCP Inspector** is the official open-source debugging tool from the MCP team ([GitHub](https://github.com/modelcontextprotocol/inspector)). It provides a browser-based UI to connect to any MCP server, browse tools/resources/prompts, and invoke them interactively.

> **Important**: This is NOT a custom AgentShield tool — it's a universal MCP testing tool that works with any MCP server deployed anywhere.

### Prerequisites

- Node.js v18+ installed
- AgentShield API running (locally or on GCP)

### Launch

```bash
npx -y @modelcontextprotocol/inspector
```

**Output:**
```
Starting MCP inspector...
⚙️ Proxy server listening on 127.0.0.1:6277
🔑 Session token: <token>
🔗 Open inspector with token pre-filled:
   http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=<token>
🔍 MCP Inspector is up and running at http://127.0.0.1:6274 🚀
```

Open the URL with the token in your browser.

### Configuration for AgentShield Agents

Once the Inspector UI opens:

1. **Transport Type**: Select **"Streamable HTTP"** from the dropdown
2. **URL**: Enter the **AgentShield gateway** URL (not the upstream URL):
   ```
   https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/<agent-slug>
   ```
   Example: `https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp`

3. **Headers**: Add authentication header:
   - **Header Name**: `X-API-Key`
   - **Header Value**: Your AgentShield API key (e.g., `ask_3c499cb5...`)

4. Click **"Connect"**

> **Traffic flow**: MCP Inspector → AgentShield MCP Proxy (`/mcp/:slug`) → Upstream MCP  
> All governance (auth, policy, guardrails, budget, audit) is enforced by the MCP proxy.

### Testing Tools

Once connected:

1. Click the **"Tools"** tab to see all available tools
2. Click any tool name to see its input schema
3. Fill in the parameters and click **"Run"** to invoke
4. View the JSON-RPC response in the results pane

### Testing Other MCP Servers (Not Just AgentShield)

The Inspector works with any MCP server — change the URL:

| Server | Transport | URL |
|--------|-----------|-----|
| AgentShield Proxy | Streamable HTTP | `https://agentshield-api-.../mcp/corpgcpmcp` |
| Direct upstream MCP | Streamable HTTP | `https://corp-chatbot-backend-.../mcp` |
| AWS Stock MCP | Streamable HTTP | `http://44.252.40.7:8001/mcp` |
| Weather MCP (SSE) | SSE | `https://weather-mcp-.../mcp/sse` |
| Local dev server | Streamable HTTP | `http://localhost:8000/mcp` |

### Saving Multiple MCP Configs

The Inspector does **not** support saved profiles. Workaround: open multiple browser tabs, each connected to a different agent URL. They run independently.

### Stopping the Inspector

Press `Ctrl+C` in the terminal where it's running, or close the terminal.

---

## 3. Dashboard MCP Explorer (Built-in)

### What Is It?

A built-in MCP testing UI inside the AgentShield admin dashboard. Unlike MCP Inspector, it:
- **Auto-discovers** all registered MCP agents from the registry
- **Enforces governance** (policy, guardrails, audit) with configurable user context
- **Shows governance check results** as visual badges (✅/❌)
- **Lets you switch between agents** from a dropdown — no URL needed

### How to Access

1. Open `https://agentshield-dashboard.web.app`
2. Login with your admin credentials
3. Navigate to **Playground** in the sidebar
4. Click the **🔌 MCP Explorer** tab

### Features

| Feature | Description |
|---------|-------------|
| **Agent dropdown** | Lists all registered MCP agents from the registry |
| **User context** | Set Role, Email, Department to test policy scenarios |
| **Tool browser** | Left sidebar lists all tools with descriptions and required params |
| **Tool detail** | Shows full description, input schema, auto-generated form |
| **Run Tool** | Click to invoke — enforces policy, guardrails, audit first |
| **Governance badges** | Shows ✅/❌ for Status, Policy, Guardrails checks |
| **Result panel** | Pretty-printed JSON response with latency |

### User Context for Policy Testing

The MCP Explorer includes **User Context** fields that are sent to the policy engine:

- **User Role**: viewer / editor / admin / super_admin
- **User Email**: e.g., `test@example.com`
- **Department**: engineering / finance / hr / legal / marketing / operations / sales

Changing these fields lets you test how different users would experience governance enforcement without creating actual user accounts.

### Testing Policy Denial

1. Go to **Policies** → Create a deny rule (e.g., deny `viewer` role from `corpgcpmcp`)
2. Return to **Playground** → **MCP Explorer**
3. Set **User Role** to `viewer`
4. Click **Run Tool** on any tool
5. You should see:
   - 🛡️ **Governance Checks** → ❌ Policy: denied
   - 🚫 **Blocked** — "Tool call was blocked by governance checks"

### Comparison: MCP Explorer vs MCP Inspector

| Aspect | MCP Explorer (Dashboard) | MCP Inspector |
|--------|-------------------------|---------------|
| Install needed | None — built into dashboard | `npx @modelcontextprotocol/inspector` |
| Agent discovery | Auto — dropdown from registry | Manual — type URL each time |
| Auth | JWT (dashboard login) | API Key (manual header) |
| Governance visible | ✅ Check badges shown | ❌ Not visible |
| User context testing | ✅ Role/email/dept fields | ❌ Not available |
| Works with non-AgentShield MCPs | ❌ Only registered agents | ✅ Any MCP server |
| Entry point | Admin API (`/api/v1/playground/mcp-*`) | MCP Proxy (`/mcp/:slug`) |

---

## 4. Claude Desktop Integration

### Why a Bridge Is Needed

Claude Desktop's `claude_desktop_config.json` only supports **stdio-based** MCP servers (using `command` + `args`). It does NOT support the `url` + `headers` format for remote HTTP MCP servers.

To connect Claude Desktop to AgentShield's HTTP-based MCP proxy, we need a **stdio-to-HTTP bridge** — a small Node.js script that:
- Reads JSON-RPC messages from stdin (Claude Desktop)
- Forwards them to AgentShield's MCP proxy via HTTPS
- Writes responses back to stdout (Claude Desktop)

### Bridge Script

AgentShield includes a custom bridge at `tools/mcp-bridge.js` that is compatible with Node.js v18+.

> **Why not `mcp-remote`?** The popular `mcp-remote` npm package requires Node.js v20.18.1+. Our bridge works with Node.js v18+ which is more widely available.

### Configuration

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "corporate-knowledge-base": {
      "command": "node",
      "args": ["/Users/<your-username>/AntiGravityProjects/agentshield/tools/mcp-bridge.js"],
      "env": {
        "MCP_ENDPOINT": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
        "MCP_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

> **Important**: Use the absolute path to `mcp-bridge.js`. Relative paths won't work.  
> **Important**: The `MCP_ENDPOINT` must point to the **AgentShield gateway** URL (`/mcp/:slug`), not the upstream URL.

### Adding Multiple Agents

```json
{
  "mcpServers": {
    "corporate-kb": {
      "command": "node",
      "args": ["/path/to/agentshield/tools/mcp-bridge.js"],
      "env": {
        "MCP_ENDPOINT": "https://agentshield-api-.../mcp/corpgcpmcp",
        "MCP_API_KEY": "your-api-key"
      }
    },
    "weather-service": {
      "command": "node",
      "args": ["/path/to/agentshield/tools/mcp-bridge.js"],
      "env": {
        "MCP_ENDPOINT": "https://agentshield-api-.../mcp/weather-mcp",
        "MCP_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Restart and Verify

1. **Fully quit** Claude Desktop (`Cmd+Q` on macOS)
2. Reopen Claude Desktop
3. Start a new conversation
4. Look for the **🔨 tool icon** in the chat input area
5. Test with: *"What documents are in the corporate knowledge base?"*

---

## 5. curl / Command Line Testing

The most direct way to test — no tools to install.

### Initialize Connection (MCP Proxy)

```bash
API_KEY="your-api-key"
BASE="https://agentshield-api-zfv2wfb7ba-uc.a.run.app"

curl -s -X POST "$BASE/mcp/corpgcpmcp" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {"name": "curl-test", "version": "1.0.0"}
    }
  }' | python3 -m json.tool
```

### List Available Tools

```bash
curl -s -X POST "$BASE/mcp/corpgcpmcp" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 -m json.tool
```

### Call a Tool

```bash
curl -s -X POST "$BASE/mcp/corpgcpmcp" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "list_documents",
      "arguments": {}
    }
  }' | python3 -m json.tool
```

### Test Authentication Failure

```bash
# No API key — should return -32001 error
curl -s -X POST "$BASE/mcp/corpgcpmcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

### Test via REST Gateway (Alternative)

```bash
# Using JWT token via REST gateway instead of MCP proxy
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agentshield.local","password":"admin123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')

curl -s -X POST "$BASE/api/v1/gateway/agents/corpgcpmcp/invoke" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool": "list_documents", "arguments": {}}' \
  | python3 -m json.tool
```

---

## 6. Python MCP Client

For programmatic testing or integration into test suites:

```bash
pip install mcp
```

```python
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def test_agentshield_mcp():
    # Points to AgentShield gateway — NOT the upstream URL
    url = "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp"
    headers = {"X-API-Key": "your-api-key-here"}

    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # List tools
            tools = await session.list_tools()
            print(f"Found {len(tools.tools)} tools:")
            for tool in tools.tools:
                print(f"  - {tool.name}: {tool.description[:60]}...")

            # Call a tool
            result = await session.call_tool("list_documents", arguments={})
            print(f"\nResult: {result}")

asyncio.run(test_agentshield_mcp())
```

---

## 7. Governance Enforcement — Two Paths

All testing tools route through AgentShield, but via two different code paths. Both enforce governance.

### Path 1: MCP Proxy (`/mcp/:slug`)

Used by: **MCP Inspector**, **Claude Desktop**, **curl**, **Python MCP Client**

```
External MCP Client
       │
       ▼
AgentShield MCP Proxy (/mcp/:agentSlug)
  1. Authenticate (API Key)
  2. Resolve agent from Registry
  3. Policy check
  4. Guardrail check
  5. Budget check
  6. Forward JSON-RPC to upstream MCP
  7. Audit log
  8. Return response
       │
       ▼
Upstream MCP Server
```

### Path 2: Admin API (`/api/v1/playground/mcp-*`)

Used by: **Dashboard MCP Explorer**

```
Dashboard (browser)
       │
       ▼
AgentShield Admin API (/api/v1/playground/mcp-tools, /mcp-call)
  1. Authenticate (JWT from dashboard session)
  2. Resolve agent from Registry
  3. Policy check (using user context from form)
  4. Guardrail check
  5. Call upstream MCP directly
  6. Audit log
  7. Return response with governance check results
       │
       ▼
Upstream MCP Server
```

### Governance Comparison

| Check | MCP Proxy | Admin API (MCP Explorer) |
|-------|-----------|--------------------------|
| Auth | API Key | JWT |
| Policy eval | ✅ (proxy middleware) | ✅ (inline, uses form user context) |
| Guardrails | ✅ (proxy middleware) | ✅ (inline check) |
| Budget check | ✅ | — |
| Audit log | ✅ | ✅ |
| URL shown | Gateway URL | Gateway URL |

> **Key difference**: The MCP Proxy uses the real API Key identity for policy evaluation. The MCP Explorer uses the **simulated** user context (role/email/department) from the form, letting admins test how different users would experience governance.

---

## 8. Issues Fixed During Implementation

### Issue 1: MCP Health Check Transport Detection

**Problem**: The chatbot MCP server at `/mcp` was being detected as SSE transport instead of Streamable HTTP, causing the health check to fail and the agent to show as "unhealthy" in AgentShield.

**Root Cause**: The `isSSEEndpoint()` function in `mcp-client.js` used a regex `/\/sse\b/` to detect SSE URLs. Since the chatbot's endpoint was `/mcp` (without `/sse`), it correctly fell through to Streamable HTTP. However, the health check was intermittently failing due to connection timeouts on cold-started Cloud Run instances.

**Fix**: Updated the health check timeout from 5s to 8s and ensured transport auto-detection properly handles both `/sse` and `/mcp` endpoints.

**File**: `src/gateway/mcp-client.js`

---

### Issue 2: MCP Endpoint Path Doubling

**Problem**: The registered endpoint URL was `https://...run.app/mcp/mcp` (double `/mcp`), causing 404 errors when the health checker tried to reach the upstream MCP server.

**Root Cause**: The chatbot's FastAPI MCP server mounted at `/mcp`, and the registration URL already included `/mcp`. The health check code was appending an additional `/mcp` path segment.

**Fix**: Updated `src/registry/health.js` to detect when the URL already ends with the MCP path and avoid doubling it.

**File**: `src/registry/health.js`

---

### Issue 3: Claude Desktop Config Format Incompatibility

**Problem**: Claude Desktop rejected the `url` + `headers` format in `claude_desktop_config.json` with error: *"The following entries are not valid MCP server configurations and were skipped"*.

**Root Cause**: Claude Desktop's config file only supports `command` + `args` format (stdio-based servers). The `url` field is NOT supported in the config file — remote HTTP servers must either use the Connectors UI or a stdio-to-HTTP bridge like `mcp-remote`.

**Fix**: Created a custom stdio-to-HTTP bridge script (`tools/mcp-bridge.js`) that uses `command` + `args` format and translates between Claude Desktop's stdio protocol and AgentShield's Streamable HTTP MCP proxy.

**File**: `tools/mcp-bridge.js`

---

### Issue 4: `mcp-remote` Requires Node.js v20.18.1+

**Problem**: The popular `mcp-remote` npm package crashed with `ReferenceError: File is not defined` on Node.js v18.

**Root Cause**: `mcp-remote` depends on `undici@7.28` which requires Node.js v20.18.1+. The local machine had Node.js v18.20.8.

**Fix**: Built a custom lightweight bridge (`tools/mcp-bridge.js`) using only Node.js v18 built-in modules (`https`, `http`, `readline`) — no external dependencies required.

**File**: `tools/mcp-bridge.js`

---

### Issue 5: Cloud Run Deployment Missing Database Config

**Problem**: After deploying the MCP proxy feature, the service returned `ECONNREFUSED 127.0.0.1:5432` — database unreachable.

**Root Cause**: The `gcloud run deploy` command was missing critical environment variables (`DB_HOST`, `DB_USER`, `DB_NAME`) and infrastructure flags (`--add-cloudsql-instances`, `--vpc-connector`) that the previous working revision had.

**Fix**: Retrieved the exact environment configuration from the last working revision (`agentshield-api-00014-8nd`) and redeployed with matching settings:
- `DB_HOST=35.224.1.245` (direct IP via VPC, not Cloud SQL socket)
- `DB_USER=agentshield` (not `agentshield_user`)
- `--vpc-connector=agentshield-vpc` (not `agentshield-vpc-connector`)

**Lesson**: Always check the previous working revision's config with:
```bash
gcloud run revisions describe <revision-name> \
  --region=us-central1 --project=agentshield-poc \
  --format='yaml(spec.containers[0].env)'
```

---

### Issue 6: Agent Health Status Blocking MCP Proxy

**Problem**: The MCP proxy returned `"Agent corpgcpmcp is currently unhealthy"` even though the upstream MCP server was reachable and responding correctly to tool calls.

**Root Cause**: AgentShield's periodic health checker runs on a timer. When the Cloud Run instance cold-starts, the health check may fail transiently, marking the agent as "unhealthy" in the database. The MCP proxy was gating on `health_status === 'unhealthy'` and rejecting requests.

**Fix**: The health status self-corrected after a successful health check cycle. For production, consider:
- Making the health check more lenient (retry on transient failures)
- Adding a force-refresh health check endpoint
- Allowing proxy requests to "degraded" agents with a warning header

---

### Issue 7: MCP Explorer Missing Governance Enforcement

**Problem**: The initial MCP Explorer implementation in the dashboard bypassed policy enforcement — it called tools directly without checking policies, guardrails, or logging to audit.

**Root Cause**: The `POST /playground/mcp-call` endpoint was calling `invokeMcpAgent(agent.endpoint_url, ...)` directly without any governance middleware.

**Fix**: Added full governance pipeline to both endpoints:
- `POST /playground/mcp-tools` — policy check before listing tools
- `POST /playground/mcp-call` — status check → policy check → guardrails check → tool call → audit log

Also added user context fields (Role, Email, Department) to the UI so users can simulate policy scenarios.

**Files**: `src/admin/routes.js`, `dashboard/src/pages/Playground.jsx`, `dashboard/src/api.js`

---

### Issue 8: MCP Explorer Showing Upstream URL Instead of Gateway URL

**Problem**: The MCP Explorer's connection info banner showed the upstream MCP server URL (e.g., `https://corp-chatbot-backend-.../mcp`) instead of the AgentShield gateway URL.

**Root Cause**: The `mcp-tools` endpoint was returning `agent.endpoint_url` (the upstream URL from the registry) in the response.

**Fix**: Changed the response to compute and return the AgentShield gateway URL:
```js
const gatewayUrl = `${req.protocol}://${req.get('host')}/mcp/${agent.slug}`;
```

**File**: `src/admin/routes.js`

---

## 9. Architecture Reference

### Complete Testing Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TESTING TOOLS                                │
│                                                                      │
│  MCP Inspector    Claude Desktop    curl    Python Client            │
│       │                │              │           │                   │
│       └────────────────┼──────────────┼───────────┘                  │
│                        │              │                               │
│                        ▼              ▼                               │
│          ┌─────────────────────────────────┐                         │
│          │  AgentShield MCP Proxy          │                         │
│          │  POST /mcp/:agentSlug           │                         │
│          │  Auth: X-API-Key                │ ──── Path 1             │
│          │  Full governance pipeline       │                         │
│          └───────────────┬─────────────────┘                         │
│                          │                                           │
│  Dashboard MCP Explorer  │                                           │
│       │                  │                                           │
│       ▼                  │                                           │
│  ┌─────────────────────┐ │                                           │
│  │ Admin API            │ │                                          │
│  │ POST /playground/*   │ │                                          │
│  │ Auth: JWT            │ ──── Path 2                                │
│  │ Inline governance    │ │                                          │
│  └──────────┬──────────┘ │                                           │
│             │            │                                           │
│             ▼            ▼                                           │
│      ┌───────────────────────────┐                                   │
│      │   Upstream MCP Server     │                                   │
│      │   (e.g., corp-chatbot)    │                                   │
│      └───────────────────────────┘                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/gateway/mcp-proxy.js` | MCP protocol proxy with full governance (Path 1) |
| `src/gateway/mcp-client.js` | MCP client transport (SSE + Streamable HTTP) |
| `src/admin/routes.js` | Admin API with MCP Explorer endpoints (Path 2) |
| `tools/mcp-bridge.js` | Claude Desktop stdio-to-HTTP bridge |
| `src/index.js` | Route mounting (`/mcp` → mcp-proxy) |
| `src/gateway/middleware/index.js` | Auth bypass for MCP proxy path |
| `dashboard/src/pages/Playground.jsx` | MCP Explorer UI (🔌 tab) |
| `dashboard/src/api.js` | Frontend API client (mcpListTools, mcpCallTool) |
