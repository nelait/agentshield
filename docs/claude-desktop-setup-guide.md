# Testing MCP Agents via Claude Desktop — Step-by-Step Guide

> **Prerequisite**: An MCP agent registered in AgentShield's Agent Registry  
> **Time Required**: ~10 minutes  
> **Difficulty**: Beginner

---

## What You'll Achieve

By the end of this guide, you'll have Claude Desktop connected to a registered MCP agent **through AgentShield**, meaning every tool call Claude makes will be:

- ✅ Authenticated via your API key
- ✅ Policy-checked against your access rules
- ✅ Guardrail-protected for input safety
- ✅ Audit-logged in the AgentShield dashboard
- ✅ Cost-tracked for token usage

---

## Step 1: Get Your AgentShield API URL

Your AgentShield MCP proxy URL follows this pattern:

```
https://<your-agentshield-api>/mcp/<agent-slug>
```

**How to find your agent slug:**

1. Open the AgentShield Dashboard → **Agent Registry**
2. Find the MCP agent you want to connect
3. Note the **slug** value (e.g., `corpgcpmcp`)

**Your proxy URL will be:**
```
https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp
```

> **Important**: Only agents with protocol `mcp` work with this proxy. REST agents should use the REST gateway instead.

---

## Step 2: Create an API Key in AgentShield

Claude Desktop needs credentials to authenticate with AgentShield.

1. Open the AgentShield Dashboard
2. Go to **Settings** → **API Keys**
3. Click **Create API Key**
4. Fill in:
   - **Name**: `claude-desktop` (or any descriptive name)
   - **Scopes**: Select at minimum `agent:invoke`
   - **Expiry**: Set as needed
5. Click **Create**
6. **Copy the API key immediately** — it won't be shown again

Example key: `ask_a1b2c3d4e5f6...`

---

## Step 3: Configure Claude Desktop

### 3a. Find the Configuration File

Open the Claude Desktop config file:

| OS | Path |
|----|------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

**Quick open on macOS:**
```bash
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

If the file doesn't exist, create it.

### 3b. Add Your MCP Server Configuration

Add or update the config file with the following. Replace the placeholders with your actual values:

```json
{
  "mcpServers": {
    "corporate-knowledge-base": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
      "headers": {
        "X-API-Key": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

**If you already have other MCP servers configured**, just add the new entry inside the existing `mcpServers` block:

```json
{
  "mcpServers": {
    "existing-server": {
      "command": "..."
    },
    "corporate-knowledge-base": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
      "headers": {
        "X-API-Key": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### 3c. Connecting Multiple Agents

You can add **multiple AgentShield-registered MCP agents** — each gets its own entry. Just change the slug in the URL:

```json
{
  "mcpServers": {
    "corporate-kb": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
      "headers": { "X-API-Key": "YOUR_API_KEY" }
    },
    "code-assistant": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/code-assist-mcp",
      "headers": { "X-API-Key": "YOUR_API_KEY" }
    },
    "data-pipeline": {
      "url": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/data-pipeline-mcp",
      "headers": { "X-API-Key": "YOUR_API_KEY" }
    }
  }
}
```

---

## Step 4: Restart Claude Desktop

**Fully quit and relaunch Claude Desktop** for the config to take effect.

- **macOS**: `Cmd + Q` then reopen from Applications
- **Windows**: Right-click system tray icon → Quit, then reopen

---

## Step 5: Verify the Connection

Once Claude Desktop relaunches:

1. Start a **new conversation**
2. Look for the **🔌 tool icon** (hammer/wrench icon) in the chat input area
3. Click it — you should see the tools from your registered MCP agent listed

For the corporate knowledge base example, you'd see:
- `query_knowledge_base`
- `search_documents`
- `list_documents`
- `upload_text_document`
- `get_document_details`

> **If you don't see tools**: Check the Claude Desktop developer console for errors. The most common issue is an incorrect API key or URL.

---

## Step 6: Test It!

Try these prompts in Claude Desktop to verify everything works:

### Test 1 — List Documents
```
What documents are in the corporate knowledge base? Use the list_documents tool.
```

**Expected**: Claude calls `list_documents` and shows a list of uploaded documents.

### Test 2 — Ask a Question (RAG)
```
What is our company's remote work policy?
```

**Expected**: Claude calls `query_knowledge_base`, retrieves relevant document chunks, and gives a cited answer.

### Test 3 — Search Documents
```
Search for documents about employee onboarding.
```

**Expected**: Claude calls `search_documents` and returns matching document chunks.

---

## Step 7: Verify Governance in AgentShield Dashboard

After running some test prompts, open the AgentShield Dashboard to verify governance is working:

### Check Audit Logs
1. Go to **Audit Logs** in the sidebar
2. You should see entries with:
   - **Event Type**: `mcp_proxy_request`
   - **Action**: `mcp:tools/call:list_documents`, `mcp:tools/call:query_knowledge_base`, etc.
   - **Actor**: Your API key identity
   - **Outcome**: `allowed`

### Check Cost Tracking
1. Go to **Cost Management** in the sidebar
2. You should see token usage entries from the MCP proxy calls

### Test Policy Denial (Optional)
1. Go to **Policies** → **Create Policy**
2. Create a deny policy for the API key's role targeting the agent slug
3. Try the same prompt in Claude Desktop
4. Claude should report an error — and the audit log should show `outcome: denied`

---

## Troubleshooting

### "Could not connect to MCP server"

| Cause | Fix |
|-------|-----|
| Wrong URL | Verify the URL matches `https://<api>/mcp/<slug>` exactly |
| Agent not found | Check the agent slug in Agent Registry |
| Agent not MCP | Only agents with `protocol: mcp` work. REST agents need the REST gateway |
| Agent inactive | Activate the agent in Agent Registry |
| Agent unhealthy | Check the agent's upstream endpoint health |

### "Authentication required" or "Invalid API key"

| Cause | Fix |
|-------|-----|
| Missing API key | Ensure `X-API-Key` header is in the config |
| Expired API key | Create a new API key in Settings → API Keys |
| Wrong header format | Use `"X-API-Key"` (not `"x-api-key"` or `"Authorization"`) |

### "Access denied by policy"

This means governance is working correctly! The configured policies are blocking the request. Check **Policies** in the dashboard to adjust.

### Tools not showing in Claude Desktop

1. Make sure you fully quit and relaunched Claude (not just close/reopen the window)
2. Verify the JSON config is valid (no trailing commas, proper quotes)
3. Check if the file path is correct for your OS
4. Look at Claude Desktop logs for connection errors

---

## Quick Reference

| Item | Value |
|------|-------|
| **Proxy URL Pattern** | `https://<agentshield-api>/mcp/<agent-slug>` |
| **Auth Header** | `X-API-Key: <your-key>` |
| **Config File (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Config File (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Supported Agents** | Only `protocol: mcp` agents from Agent Registry |
| **Audit Event Type** | `mcp_proxy_request` |
| **Dashboard** | `https://agentshield-dashboard.web.app` |
