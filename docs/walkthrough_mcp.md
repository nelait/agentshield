# Walkthrough — MCP Protocol Proxy for AgentShield

## What Was Built

A native MCP protocol proxy that lets MCP clients (Claude Desktop, Cursor, etc.) connect to registered MCP agents **through AgentShield's governance layer**.

### New Files

| File | Purpose |
|------|---------|
| [mcp-proxy.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/mcp-proxy.js) | Core MCP proxy router — handles JSON-RPC, auth, governance, upstream forwarding |
| [mcp-proxy-usage.md](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/docs/mcp-proxy-usage.md) | Usage guide for Claude Desktop, Cursor, Python/TypeScript/curl clients |

### Modified Files

| File | Change |
|------|--------|
| [index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/index.js) | Mounted MCP proxy at `/mcp` route |
| [middleware/index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/middleware/index.js) | Auth bypass for `/mcp/` (proxy handles its own auth) |
| [mcp-client.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/mcp-client.js) | Exported `createTransport` and `isSSEEndpoint` for reuse |

## Proxy URL

```
https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/<agent-slug>
```

Example for the corporate chatbot MCP:
```
https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp
```

## Verification Results

All tests passed on deployed revision `agentshield-api-00018-t47`:

| Test | Method | Result |
|------|--------|--------|
| ✅ Initialize | `initialize` | Returns `AgentShield → Corporate Knowledge Assistant` with upstream capabilities |
| ✅ Tool discovery | `tools/list` | Returns all 5 tools (query_knowledge_base, search_documents, list_documents, upload_text_document, get_document_details) |
| ✅ Tool invocation | `tools/call` | Called `list_documents` — returned 3 real documents with full metadata |
| ✅ Auth denial | No headers | Returns JSON-RPC error `-32001: Authentication required` |
| ✅ Invalid agent | Bad slug | Returns JSON-RPC error `-32002: Agent not found in registry` |

## Governance Enforcement

The proxy enforces all governance on `tools/call` requests:

- **Authentication** — API Key (`X-API-Key`) or JWT (`Authorization: Bearer`)
- **Policy** — Same OPA policy engine as REST gateway
- **Budget** — Token/cost limit checks per user/team/agent
- **Guardrails** — Input validation rules
- **Audit** — Logged as `mcp_proxy_request` with tool name
- **Cost Tracking** — Token estimation and recording
