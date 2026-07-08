# MCP Protocol Proxy for AgentShield

Enable MCP clients (Claude Desktop, Cursor, custom agents) to access registered MCP agents **through AgentShield**, with full governance enforcement.

## Background

### Current State

AgentShield has a **REST-only gateway** for agent invocation:

```
MCP Client ──✗──> AgentShield (no MCP endpoint) ──REST──> Upstream MCP
```

The gateway at `POST /api/v1/gateway/agents/:slug/invoke` wraps MCP calls in REST. This works for the dashboard playground but **cannot be used by MCP clients** like Claude Desktop because they require actual MCP protocol endpoints (Streamable HTTP or SSE).

### What We Need

```
Claude Desktop ──MCP──> AgentShield Proxy ──MCP──> Upstream MCP Server
                            │
                    ┌───────┴────────┐
                    │ Auth           │
                    │ Policy         │
                    │ Budget         │
                    │ Guardrails     │
                    │ Audit          │
                    │ Compliance     │
                    │ Cost Tracking  │
                    └────────────────┘
```

### Existing Mechanisms Studied

| Component | File | How It Works |
|-----------|------|-------------|
| **Middleware Chain** | [middleware/index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/middleware/index.js) | 6-layer chain: traceId → auth (JWT/API Key) → audit → policy → budget → guardrails → compliance. Each middleware gates on `req.path.startsWith('/api/v1/gateway/')`. |
| **Gateway Proxy** | [proxy.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/proxy.js) | `forwardToAgent()` detects `agent.protocol === 'mcp'` and delegates to MCP client. Otherwise uses axios HTTP POST. |
| **MCP Client** | [mcp-client.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/mcp-client.js) | Auto-detects SSE vs Streamable HTTP transport from URL. Connects, lists tools, calls tool, disconnects per request. |
| **Route Mount** | [index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/index.js) | Routes: `/api/v1/agents` (registry), `/api/v1` (admin), `/api/v1/gateway` (proxy), `/api/v1/reports` (reports). Global middleware applied to all routes. |
| **MCP SDK v1.27.1** | `@modelcontextprotocol/sdk` | Has both client (`Client`, `StreamableHTTPClientTransport`) and **server** (`Server`, `StreamableHTTPServerTransport`, `createMcpExpressApp`) modules. The server side provides `handleRequest(req, res, parsedBody)` for Express integration. |

### Key Design Decisions

> [!IMPORTANT]  
> **Stateless proxy vs. Stateful session proxy?**  
> The proxy should be **stateless** (no persistent sessions) to keep it simple and scalable. Each JSON-RPC request from the client is independently authenticated, policy-checked, and forwarded to the upstream MCP. This matches how the existing REST gateway works.

> [!IMPORTANT]  
> **Where to mount the MCP proxy?**  
> At `/mcp/:agentSlug` — a new top-level route alongside `/api/v1/gateway/`. This is cleaner than nesting under the REST API and gives MCP clients a natural endpoint URL:  
> `https://agentshield-api-...run.app/mcp/corpgcpmcp`

---

## Proposed Changes

### Gateway Layer

#### [NEW] [mcp-proxy.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/mcp-proxy.js)

The core new module — an Express router that:

1. **Receives** raw MCP JSON-RPC requests (POST) from MCP clients (Claude Desktop, Cursor, etc.)
2. **Authenticates** the caller (API Key via `X-API-Key` header — Claude Desktop supports custom headers)
3. **Resolves** the agent from the registry by slug
4. **Enforces** policy, budget, and guardrails using the same service layer as the REST gateway
5. **Proxies** the JSON-RPC request to the upstream MCP server using the existing MCP client transport
6. **Logs** audit entries and tracks cost
7. **Returns** the upstream MCP response back to the client

**Architecture**: The proxy acts as a transparent MCP server that re-exposes registered upstream MCP tools. It does **NOT** create a persistent `Server` instance. Instead, for each incoming JSON-RPC request, it:

```
┌─────────────────────────────────────────────────────────────┐
│  POST /mcp/:agentSlug                                      │
│                                                             │
│  1. Parse JSON-RPC message from request body                │
│  2. Auth: validate API Key from X-API-Key header            │
│  3. Registry: resolve agent by slug, check active + healthy │
│  4. Policy: evaluate(user, agent, action='mcp_invoke')      │
│  5. Guardrail: check input payload for violations           │
│  6. Forward: create MCP Client → connect → forward request  │
│  7. Audit: log the interaction                              │
│  8. Cost: estimate and record token usage                   │
│  9. Return: upstream MCP response to caller                 │
└─────────────────────────────────────────────────────────────┘
```

The proxy handles these JSON-RPC methods:
- `initialize` → Intercept and respond with AgentShield's server info + upstream capabilities
- `tools/list` → Forward to upstream, return tool list
- `tools/call` → Enforce governance, then forward to upstream
- `ping` → Respond directly (health check)
- `notifications/initialized` → Acknowledge (no-op)

```javascript
// Key structure (simplified)
router.post('/mcp/:agentSlug', async (req, res) => {
    const { agentSlug } = req.params;
    const jsonrpcMessage = req.body;
    
    // 1. Auth (API Key)
    const identity = await apiKeyService.validateKey(req.headers['x-api-key']);
    
    // 2. Resolve agent
    const agent = await RegistryService.getAgent(agentSlug);
    
    // 3. Policy check (on tool calls)
    if (jsonrpcMessage.method === 'tools/call') {
        const decision = await policyService.evaluate(context);
        if (!decision.allowed) return res.status(403)...;
    }
    
    // 4. Forward to upstream MCP
    const client = new Client({ name: 'agentshield-proxy' });
    await client.connect(createTransport(agent.endpoint_url));
    // ... forward and return response
});
```

---

#### [MODIFY] [index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/index.js)

Mount the new MCP proxy route:

```diff
 const gatewayRoutes = require('./gateway/proxy');
+const mcpProxyRoutes = require('./gateway/mcp-proxy');

 app.use('/api/v1/gateway', gatewayRoutes);
+app.use('/mcp', mcpProxyRoutes);  // MCP protocol proxy
```

---

#### [MODIFY] [middleware/index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/middleware/index.js)

Update the middleware path gates to include the MCP proxy path. Currently, policy/budget/guardrails/compliance only trigger for paths starting with `/api/v1/gateway/`. We need them to also trigger for `/mcp/`.

```diff
 function policyEnforcer(req, res, next) {
-    if (!req.path.startsWith('/api/v1/gateway/') || ...) {
+    if ((!req.path.startsWith('/api/v1/gateway/') && !req.path.startsWith('/mcp/')) || ...) {
         return next();
     }
```

Same pattern for `budgetChecker`, `guardrailEnforcer`, and `complianceSampler`.

---

#### [MODIFY] [middleware/index.js](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/src/gateway/middleware/index.js) — Auth bypass

The MCP proxy will handle its own auth internally (API Key extracted from headers per MCP convention), so the global `authenticate` middleware should skip `/mcp/` paths:

```diff
 const publicPaths = ['/api/v1/auth/login', '/api/v1/auth/refresh', ..., '/health', '/ready'];
+// MCP proxy handles its own auth
+if (req.path.startsWith('/mcp/')) return next();
```

---

### Configuration & Documentation

#### [NEW] [docs/mcp-proxy-usage.md](file:///Users/krishnakollepara/AntiGravityProjects/agentshield/docs/mcp-proxy-usage.md)

Usage guide showing how to configure Claude Desktop, Cursor, and custom clients.

---

## Open Questions

> [!IMPORTANT]
> **Session management**: Should the proxy maintain persistent sessions (one MCP Client connection per caller session) or create a new connection per request? Per-request is simpler and matches the current `mcp-client.js` pattern but has ~200ms connection overhead. Per-session needs state management but is faster for multi-turn interactions.
> **Recommendation**: Start with per-request (stateless). Optimize later if latency becomes an issue.

> [!IMPORTANT]  
> **Auth method**: Claude Desktop supports custom headers. Should we also support auth via query parameter (`?apiKey=xxx`) for clients that don't support custom headers? Or only `X-API-Key` header?

---

## Verification Plan

### Automated Tests

```bash
# 1. Direct JSON-RPC test — initialize
curl -X POST https://agentshield-api-...run.app/mcp/corpgcpmcp \
  -H "X-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'

# 2. List tools through proxy
curl -X POST .../mcp/corpgcpmcp \
  -H "X-API-Key: <key>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list",...}'

# 3. Call a tool through proxy  
curl -X POST .../mcp/corpgcpmcp \
  -H "X-API-Key: <key>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_documents","arguments":{}}}'

# 4. Policy denial test — use restricted API key
# Should return 403 before forwarding

# 5. No auth test — should return 401
curl -X POST .../mcp/corpgcpmcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'
```

### Manual Verification

- Configure Claude Desktop with the proxy URL and verify tool discovery + invocation
- Check audit logs in AgentShield dashboard for the MCP proxy invocations
- Test policy denial by adding a deny policy for the API key's role
- Verify cost tracking entries are created
