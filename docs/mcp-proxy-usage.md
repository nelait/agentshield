# MCP Proxy Usage Guide — AgentShield

> **Feature**: MCP Protocol Proxy  
> **Version**: 1.0  
> **Date**: July 2026

---

## Overview

AgentShield's MCP Protocol Proxy lets you access any registered MCP agent through AgentShield's governance layer using the native MCP protocol. This means MCP clients like **Claude Desktop**, **Cursor**, **Windsurf**, and custom AI agents can connect to your governed MCP servers without any code changes.

### What It Does

```
MCP Client ──MCP Protocol──> AgentShield MCP Proxy ──MCP──> Upstream MCP Server
                                    │
                              ┌─────┴──────┐
                              │ ✅ Auth     │
                              │ ✅ Policy   │
                              │ ✅ Budget   │
                              │ ✅ Guardrails│
                              │ ✅ Audit    │
                              │ ✅ Cost     │
                              └────────────┘
```

Every tool call, tool listing, and connection is authenticated, policy-checked, audited, and cost-tracked.

---

## Proxy URL Format

```
https://<agentshield-api-url>/mcp/<agent-slug>
```

**Example:**
```
https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp
```

The `<agent-slug>` is the slug of the agent registered in AgentShield's Agent Registry. Only agents with `protocol: mcp` are supported via this proxy.

---

## Authentication

The proxy supports two authentication methods:

### API Key (Recommended for MCP Clients)

Create an API key in AgentShield dashboard → Settings → API Keys, then pass it via header:

```
X-API-Key: your-api-key-here
```

### JWT Bearer Token

Use a JWT token obtained from AgentShield's login API:

```
Authorization: Bearer <jwt-token>
```

---

## Client Configuration

### Claude Desktop

Add the following to your Claude Desktop MCP configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "corporate-kb": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
      "headers": {
        "X-API-Key": "your-api-key-here"
      }
    }
  }
}
```

> **Note:** Claude Desktop supports the `url` field for Streamable HTTP MCP servers (MCP protocol version 2025-03-26+).

### Cursor

In Cursor's MCP settings, add:

```json
{
  "mcpServers": {
    "corporate-kb": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
      "headers": {
        "X-API-Key": "your-api-key-here"
      }
    }
  }
}
```

### Custom MCP Client (TypeScript/JavaScript)

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

const transport = new StreamableHTTPClientTransport(
  new URL('https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp'),
  {
    requestInit: {
      headers: {
        'X-API-Key': 'your-api-key-here',
      },
    },
  }
);

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

// List tools
const { tools } = await client.listTools();
console.log('Available tools:', tools.map(t => t.name));

// Call a tool
const result = await client.callTool({
  name: 'query_knowledge_base',
  arguments: { question: 'What is the remote work policy?' },
});
console.log('Result:', result);
```

### Custom MCP Client (Python)

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client(
    "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
    headers={"X-API-Key": "your-api-key-here"},
) as (read_stream, write_stream, _):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()

        # List tools
        tools = await session.list_tools()
        for tool in tools.tools:
            print(f"  {tool.name}: {tool.description}")

        # Call a tool
        result = await session.call_tool(
            "list_documents",
            arguments={},
        )
        print(result)
```

### curl (Manual Testing)

```bash
# Initialize
curl -X POST https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp \
  -H "X-API-Key: your-api-key" \
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
  }'

# List tools
curl -X POST https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'

# Call a tool
curl -X POST https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "list_documents",
      "arguments": {}
    }
  }'
```

---

## Governance in Action

### Policy Enforcement

Policies are evaluated on **every `tools/call` request**. If a policy denies the request, the proxy returns a JSON-RPC error:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32003,
    "message": "Access denied by policy: Users with role 'viewer' cannot invoke agent 'corpgcpmcp'"
  }
}
```

### Budget Limits

If the caller's budget is exceeded:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32005,
    "message": "Budget exceeded: Monthly token limit reached for user"
  }
}
```

### Guardrails

If input violates a guardrail rule:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32004,
    "message": "Blocked by guardrail: pii_detection, toxic_content"
  }
}
```

### Audit Trail

Every MCP proxy request is logged in AgentShield's audit trail with:
- **Event type**: `mcp_proxy_request` or `mcp_proxy_policy_denied`
- **Action**: `mcp:tools/call:tool_name` (e.g., `mcp:tools/call:query_knowledge_base`)
- **Actor**: The API key or JWT user who made the request
- **Outcome**: `allowed` or `denied`

View these in the AgentShield dashboard → Audit Logs.

---

## Supported MCP Methods

| Method | Governance | Description |
|--------|-----------|-------------|
| `initialize` | Auth only | Establishes connection, returns proxy server info |
| `ping` | Auth only | Health check (handled locally, no upstream call) |
| `tools/list` | Auth only | Lists available tools from upstream |
| `tools/call` | **Full** (auth + policy + budget + guardrails + audit + cost) | Invokes a tool on the upstream MCP |
| `resources/list` | Auth only | Lists resources from upstream |
| `resources/read` | Auth only | Reads a resource from upstream |
| `prompts/list` | Auth only | Lists prompts from upstream |
| `prompts/get` | Auth only | Gets a prompt from upstream |
| `notifications/*` | Auth only | Acknowledged silently (202) |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `-32001` | Authentication failed (invalid API key or JWT) |
| `-32002` | Agent not found, not MCP, inactive, or unhealthy |
| `-32003` | Policy denied |
| `-32004` | Guardrail violation |
| `-32005` | Budget exceeded |
| `-32600` | Invalid JSON-RPC request |
| `-32601` | Method not found |
| `-32603` | Internal proxy error |

---

## Comparison: REST Gateway vs MCP Proxy

| Feature | REST Gateway (`/api/v1/gateway`) | MCP Proxy (`/mcp`) |
|---------|----------------------------------|---------------------|
| **Protocol** | REST (HTTP POST → JSON) | Native MCP (JSON-RPC 2.0) |
| **Clients** | Any HTTP client, dashboards | Claude Desktop, Cursor, MCP SDKs |
| **Auth** | JWT or API Key | JWT or API Key |
| **Policy** | ✅ Full | ✅ Full |
| **Audit** | ✅ Full | ✅ Full |
| **Cost Tracking** | ✅ Full | ✅ Full |
| **Guardrails** | ✅ Full | ✅ Full |
| **Agent Types** | REST + MCP (wrapped) | MCP only (native) |
| **Tool Discovery** | Via response data | Native MCP `tools/list` |
