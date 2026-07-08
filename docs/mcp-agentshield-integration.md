# MCP Configuration & AgentShield Integration — Setup, Issues & Resolution

> **Project**: Corporate Knowledge Assistant  
> **Platform**: Google Cloud Platform (GCP)  
> **Date**: July 2026  
> **Status**: ✅ Fully Operational  

---

## 1. Overview

The Corporate Knowledge Assistant exposes its RAG capabilities as an **MCP (Model Context Protocol) server**, allowing AI agents and agentic platforms to programmatically query corporate documents, search the knowledge base, and manage documents.

This document covers:
- How the MCP server is implemented and deployed
- How it was registered with **AgentShield** (our AI agent governance firewall)
- Three critical issues discovered during integration and how they were resolved
- End-to-end testing and verification steps

---

## 2. MCP Server Architecture

### Transport Protocol

The chatbot uses **Streamable HTTP** — the modern MCP transport introduced in the 2025-03-26 protocol revision. This is different from the older SSE (Server-Sent Events) transport.

```
┌─────────────────────────────────────────────────┐
│              Cloud Run Container                │
│                                                 │
│   FastAPI App                                   │
│   ├── /api/*          → REST API (web clients)  │
│   ├── /api/health     → Health check endpoint   │
│   └── /mcp            → Mounted MCP sub-app     │
│       └── /mcp/mcp    → Streamable HTTP handler │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Implementation Stack

| Component | Technology |
|-----------|-----------|
| MCP Framework | `FastMCP` (from `mcp` Python SDK ≥1.6.0) |
| Transport | Streamable HTTP (`mcp_server.streamable_http_app()`) |
| Web Framework | FastAPI (mounts MCP as a Starlette sub-application) |
| Deployment | Cloud Run (serverless, auto-scaling) |
| DNS Rebinding | Disabled (Cloud Run handles security via IAM + load balancer) |

### MCP Tools Exposed

The server registers five tools that AI agents can discover and invoke:

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `query_knowledge_base` | RAG-powered Q&A with source citations | `question` (required), `conversation_id` (optional) |
| `search_documents` | Semantic search returning raw document chunks | `query` (required), `top_k` (1-20, default 5) |
| `list_documents` | List all uploaded documents with metadata | None |
| `upload_text_document` | Upload and index new text content | `content` (required), `filename`, `tags` |
| `get_document_details` | Get full metadata for a single document | `doc_id` (required) |

### Key Configuration

```python
# mcp_server.py
mcp = FastMCP(
    "Corporate Knowledge Assistant",
    instructions="You are connected to a corporate document knowledge base...",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,  # Cloud Run handles security
    ),
)

# main.py — Mount as sub-application
mcp_app = mcp_server.streamable_http_app()
app.mount("/mcp", mcp_app)
```

### API Key Middleware Bypass

The MCP endpoint is exempted from the API key middleware since MCP has its own authentication model:

```python
# middleware/__init__.py
if request.url.path.startswith("/mcp"):
    return await call_next(request)  # Skip API key check
```

---

## 3. AgentShield Registration

### What is AgentShield?

AgentShield is an AI agent governance firewall that sits between AI agents and their target services. It provides:
- **Agent Registry** — centralized catalog of all AI agents/services
- **Health Monitoring** — periodic health checks for registered agents
- **Policy Enforcement** — OPA-based access control policies
- **Audit Logging** — immutable logs of all agent invocations
- **Cost Tracking** — token usage and cost monitoring
- **Playground** — test agent invocations with policy pre-checks

### Registration Details

The corporate chatbot MCP was registered as an external agent in AgentShield:

| Field | Value |
|-------|-------|
| **Name** | `corpgcpmcp` |
| **Protocol** | `mcp` |
| **Type** | `external` |
| **Vendor** | `Google` |
| **Endpoint URL** | `https://corp-chatbot-backend-87117769265.us-central1.run.app/mcp/mcp` |
| **Health Check URL** | `https://corp-chatbot-backend-87117769265.us-central1.run.app/api/health` |

---

## 4. Issues Discovered & Resolved

During integration, three critical issues were discovered that prevented the MCP from functioning in AgentShield. Each is documented with root cause, impact, and resolution.

### Issue #1: Health Check URL Mismatch

**Symptom**: Agent always showed "unhealthy" in AgentShield despite the chatbot running normally.

**Root Cause**: AgentShield's health checker auto-derives the health URL by taking the origin of the `endpoint_url` and appending `/health`:

```javascript
// AgentShield — registry/health.js
const base = new URL(agent.endpoint_url);
url = `${base.origin}/health`;  // → https://...run.app/health
```

But the chatbot's health endpoint is at `/api/health`, not `/health`:

```python
# Corporate Chatbot — routers/health.py
@router.get("/api/health")
async def health_check():
    return {"status": "healthy", ...}
```

| URL Checked | HTTP Status | Result |
|-------------|-------------|--------|
| `/health` (AgentShield default) | **404** | ❌ Marked unhealthy |
| `/api/health` (actual endpoint) | **200** | ✅ Would pass |

**Resolution**: Set an explicit `health_check_url` when registering the agent:
```
https://corp-chatbot-backend-87117769265.us-central1.run.app/api/health
```

This bypasses the auto-derivation logic and uses a simple HTTP GET, which returns 200.

---

### Issue #2: SSE vs Streamable HTTP Transport Incompatibility

**Symptom**: Even with a correct health check, AgentShield couldn't connect to or invoke the MCP server.

**Root Cause**: AgentShield's MCP client (`gateway/mcp-client.js`) was hardcoded to use **SSE transport only**:

```javascript
// BEFORE — only SSE supported
const { SSEClientTransport } = require(sseModulePath);
const transport = new SSEClientTransport(new URL(endpointUrl));
```

But the corporate chatbot uses **Streamable HTTP transport**:

```python
# Corporate Chatbot — main.py
mcp_app = mcp_server.streamable_http_app()  # NOT sse_app()
```

These are fundamentally different protocols:
- **SSE**: Client opens a long-lived GET connection, server pushes events
- **Streamable HTTP**: Client sends JSON-RPC POST requests, server responds with JSON or SSE streams

**Resolution**: Updated AgentShield's `mcp-client.js` to support both transports with auto-detection:

```javascript
// AFTER — auto-detect transport from URL pattern
const { SSEClientTransport } = require(sseModulePath);
const { StreamableHTTPClientTransport } = require(streamableHttpModulePath);

function createTransport(endpointUrl) {
    if (/\/sse\b/.test(endpointUrl)) {
        return new SSEClientTransport(new URL(endpointUrl));    // Legacy
    }
    return new StreamableHTTPClientTransport(new URL(endpointUrl)); // Modern
}
```

**Convention established**:
- URLs containing `/sse` → SSE transport (legacy MCP servers)
- All other URLs (e.g., `/mcp`) → Streamable HTTP transport (modern MCP servers)

The health checker (`registry/health.js`) was also updated to recognize `/mcp` endpoints:

```javascript
// BEFORE
const isMcpEndpoint = url.includes('/mcp/sse') || url.includes('/sse');

// AFTER — also recognizes Streamable HTTP endpoints
const isMcpEndpoint = /\/sse\b/.test(url) || /\/mcp\b/.test(url);
```

---

### Issue #3: FastMCP Mount Path Doubling

**Symptom**: After fixing the transport, POST requests to `/mcp` returned `307 Redirect → /mcp/` and then `404 Not Found`.

**Root Cause**: FastMCP's `streamable_http_app()` internally registers its route handler at the path `/mcp`. When this sub-application is then mounted in FastAPI at `/mcp`, the paths combine:

```
FastAPI mount point:  /mcp
FastMCP internal path: /mcp
Actual full path:     /mcp/mcp  ← this is where the handler lives
```

Verification via curl:

```bash
# /mcp → 307 redirect (Starlette adds trailing slash)
$ curl -s -o /dev/null -w "%{http_code}" -X POST .../mcp
307

# /mcp/ → 404 (no handler at root of sub-app)
$ curl -s -o /dev/null -w "%{http_code}" -X POST .../mcp/
404

# /mcp/mcp → 406 without Accept header, works with proper headers
$ curl -s -X POST .../mcp/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'
# → 200 OK with MCP initialize response ✅
```

**Resolution**: Updated the `endpoint_url` in AgentShield to use the correct doubled path:
```
https://corp-chatbot-backend-87117769265.us-central1.run.app/mcp/mcp
```

> **Note**: This is a known behavior of Starlette's `mount()` when sub-applications have their own route prefixes. It does not affect REST API endpoints since those are included via `include_router()` which merges routes directly.

---

## 5. Testing & Verification

### 5.1 Direct MCP Protocol Test

Verified the Streamable HTTP endpoint responds to JSON-RPC:

```bash
curl -X POST https://corp-chatbot-backend-87117769265.us-central1.run.app/mcp/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }'
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "tools": {"listChanged": false},
      "resources": {"subscribe": false, "listChanged": false}
    },
    "serverInfo": {
      "name": "Corporate Knowledge Assistant",
      "version": "1.28.1"
    }
  }
}
```

### 5.2 AgentShield Gateway Test

Verified tool discovery through the AgentShield gateway:

```bash
curl -X POST https://agentshield-api-<id>.us-central1.run.app/api/v1/gateway/agents/corpgcpmcp/invoke \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Result**: All 5 MCP tools discovered successfully at **143ms latency**.

### 5.3 Playground End-to-End Test

Verified full invocation through AgentShield's playground endpoint (status check → policy evaluation → MCP invocation):

```bash
curl -X POST https://agentshield-api-<id>.us-central1.run.app/api/v1/playground/test-invoke \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentSlug": "corpgcpmcp",
    "input": {"prompt": "list all documents"},
    "userRole": "admin",
    "userEmail": "admin@agentshield.local",
    "department": "engineering"
  }'
```

**Result**: Successfully returned 3 documents from the knowledge base:

| Document | Type |
|----------|------|
| Profile summary.pdf | PDF |
| KrishnaKollepara2026.docx | DOCX |
| test-handbook.txt | TXT |

**Checks passed**:
- ✅ Status check — agent active and healthy
- ✅ Policy check — all policies passed
- ✅ MCP invocation — tool executed and returned results

---

## 6. Configuration Reference

### AgentShield Agent Registration

When registering this MCP server in AgentShield (or any governance platform), use these values:

```json
{
  "name": "Corporate Knowledge Assistant MCP",
  "slug": "corpgcpmcp",
  "type": "external",
  "protocol": "mcp",
  "vendor": "Google",
  "endpointUrl": "https://corp-chatbot-backend-87117769265.us-central1.run.app/mcp/mcp",
  "healthCheckUrl": "https://corp-chatbot-backend-87117769265.us-central1.run.app/api/health"
}
```

> **Important**: The `endpointUrl` must point to `/mcp/mcp` (not `/mcp`) due to the FastMCP mount path doubling described in Issue #3.

### Playground JSON Payloads

**List tools (discovery)**:
```json
{}
```

**Call a specific tool**:
```json
{
  "tool": "query_knowledge_base",
  "arguments": {
    "question": "What is the company's remote work policy?"
  }
}
```

**Prompt mode (auto-routes to first matching tool)**:
```json
{
  "prompt": "list all documents in the knowledge base"
}
```

---

## 7. Lessons Learned

| # | Lesson | Detail |
|---|--------|--------|
| 1 | **Always set explicit health check URLs** | Don't rely on auto-derivation. Different frameworks put health endpoints at different paths (`/health`, `/api/health`, `/healthz`, etc.). |
| 2 | **MCP transport matters** | SSE and Streamable HTTP are incompatible transports. Clients must support both or detect which the server uses. Streamable HTTP is the modern standard. |
| 3 | **Watch for path doubling with mounted sub-apps** | When a framework like FastMCP registers routes at its own prefix AND you mount it at a prefix in your web framework, the paths compound. Always test the actual URL with `curl`. |
| 4 | **Test with protocol-level requests** | Don't just check HTTP status codes. Send actual JSON-RPC `initialize` requests with proper `Accept` headers to verify MCP compatibility. |
| 5 | **Cloud Run provides dual URLs** | Cloud Run services are accessible via both legacy (`*.a.run.app`) and new (`*.us-central1.run.app`) URL formats. Both work, but be consistent in configuration. |
