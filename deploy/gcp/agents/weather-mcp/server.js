// ============================================
// Weather MCP Server — MCP protocol test agent
// Lightweight MCP server providing weather tools.
// Used for:
//   - MCP protocol support validation
//   - Health monitoring of MCP agents
//   - Workflow chaining
// ============================================
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ── In-memory SSE connections ────────────────
const connections = new Map();

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', agent: 'weather-mcp', protocol: 'mcp', timestamp: new Date().toISOString() });
});

// ── MCP SSE Transport ────────────────────────
app.get('/mcp/sse', (req, res) => {
    const sessionId = crypto.randomUUID();

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    // Send endpoint URL for messages
    res.write(`event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`);
    connections.set(sessionId, res);

    req.on('close', () => connections.delete(sessionId));
});

// ── MCP JSON-RPC Messages ────────────────────
app.post('/mcp/messages', (req, res) => {
    const sessionId = req.query.sessionId;
    const sseRes = connections.get(sessionId);
    const { method, id, params } = req.body;

    let result;

    switch (method) {
        case 'initialize':
            result = {
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'weather-mcp', version: '1.0.0' },
            };
            break;

        case 'tools/list':
            result = {
                tools: [
                    {
                        name: 'get_weather',
                        description: 'Get current weather for a location',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                location: { type: 'string', description: 'City name' },
                            },
                            required: ['location'],
                        },
                    },
                    {
                        name: 'get_forecast',
                        description: 'Get 5-day weather forecast',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                location: { type: 'string', description: 'City name' },
                                days: { type: 'number', description: 'Number of days (1-5)' },
                            },
                            required: ['location'],
                        },
                    },
                ],
            };
            break;

        case 'tools/call': {
            const toolName = params?.name;
            const args = params?.arguments || {};

            if (toolName === 'get_weather') {
                const loc = args.location || 'Unknown';
                const temp = Math.floor(Math.random() * 30 + 60);
                result = {
                    content: [{
                        type: 'text',
                        text: `Weather in ${loc}: ${temp}°F, ${temp > 80 ? 'Sunny' : temp > 65 ? 'Partly Cloudy' : 'Overcast'}. Humidity: ${Math.floor(Math.random() * 40 + 30)}%. Wind: ${Math.floor(Math.random() * 15 + 5)} mph.`,
                    }],
                };
            } else if (toolName === 'get_forecast') {
                const loc = args.location || 'Unknown';
                const days = Math.min(args.days || 3, 5);
                const forecast = [];
                for (let i = 1; i <= days; i++) {
                    const d = new Date(); d.setDate(d.getDate() + i);
                    forecast.push(`${d.toLocaleDateString()}: ${Math.floor(Math.random() * 20 + 65)}°F`);
                }
                result = {
                    content: [{ type: 'text', text: `${days}-day forecast for ${loc}:\n${forecast.join('\n')}` }],
                };
            } else {
                result = { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
            }
            break;
        }

        default:
            result = {};
    }

    // Send response via SSE
    const response = { jsonrpc: '2.0', id, result };
    if (sseRes && !sseRes.writableEnded) {
        sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    }

    res.json({ ok: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`weather-mcp listening on :${PORT}`));
