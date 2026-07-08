#!/usr/bin/env node
/**
 * AgentShield MCP Bridge — Connects Claude Desktop (stdio) to AgentShield MCP Proxy (HTTP).
 * Compatible with Node.js v18+.
 *
 * Usage in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "agentshield-corp-kb": {
 *       "command": "node",
 *       "args": ["/absolute/path/to/mcp-bridge.js"],
 *       "env": {
 *         "MCP_ENDPOINT": "https://agentshield-api-zfv2wfb7ba-uc.a.run.app/mcp/corpgcpmcp",
 *         "MCP_API_KEY": "your-api-key-here"
 *       }
 *     }
 *   }
 * }
 */

const https = require('https');
const http = require('http');

const ENDPOINT = process.env.MCP_ENDPOINT;
const API_KEY = process.env.MCP_API_KEY;

if (!ENDPOINT || !API_KEY) {
    process.stderr.write('ERROR: MCP_ENDPOINT and MCP_API_KEY environment variables are required.\n');
    process.exit(1);
}

const parsedUrl = new URL(ENDPOINT);
const httpModule = parsedUrl.protocol === 'https:' ? https : http;

/**
 * Send a JSON-RPC message to the AgentShield MCP proxy and return the response.
 */
function sendToProxy(message) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(message);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'X-API-Key': API_KEY,
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 202) {
                    resolve(null);
                    return;
                }

                const contentType = res.headers['content-type'] || '';
                if (contentType.includes('text/event-stream')) {
                    const lines = data.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                resolve(JSON.parse(line.slice(6)));
                                return;
                            } catch { }
                        }
                    }
                    resolve(null);
                    return;
                }

                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    process.stderr.write(`Parse error: ${err.message}\nRaw: ${data.substring(0, 500)}\n`);
                    reject(err);
                }
            });
        });

        req.on('error', (err) => {
            process.stderr.write(`Request error: ${err.message}\n`);
            reject(err);
        });

        req.setTimeout(30000, () => {
            req.destroy(new Error('Request timeout'));
        });

        req.write(payload);
        req.end();
    });
}

// ── Main: Read stdio line-by-line, forward to proxy, write responses to stdout ──

let buffer = '';
let pendingMessages = [];
let processing = false;

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const message = JSON.parse(trimmed);
            pendingMessages.push(message);
        } catch (err) {
            process.stderr.write(`Invalid JSON: ${trimmed.substring(0, 100)}\n`);
        }
    }

    processQueue();
});

process.stdin.on('end', () => {
    // Process remaining buffer
    if (buffer.trim()) {
        try {
            pendingMessages.push(JSON.parse(buffer.trim()));
        } catch { }
    }
    processQueue().then(() => {
        // Keep process alive for a bit in case there are pending responses
        setTimeout(() => process.exit(0), 1000);
    });
});

async function processQueue() {
    if (processing) return;
    processing = true;

    while (pendingMessages.length > 0) {
        const message = pendingMessages.shift();
        try {
            process.stderr.write(`→ ${message.method || 'response'} (id: ${message.id ?? 'notification'})\n`);

            const response = await sendToProxy(message);

            if (response) {
                const out = JSON.stringify(response);
                process.stdout.write(out + '\n');
                process.stderr.write(`← response (id: ${response.id ?? 'n/a'})\n`);
            }
        } catch (err) {
            process.stderr.write(`Bridge error: ${err.message}\n`);

            if (message.id !== null && message.id !== undefined) {
                const errorResponse = JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32603, message: `Bridge error: ${err.message}` },
                });
                process.stdout.write(errorResponse + '\n');
            }
        }
    }

    processing = false;
}

process.stderr.write(`AgentShield MCP Bridge started → ${ENDPOINT}\n`);
