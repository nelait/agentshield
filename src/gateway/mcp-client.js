const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client');
const sseModulePath = path.join(path.dirname(require.resolve('@modelcontextprotocol/sdk/client')), 'sse.js');
const { SSEClientTransport } = require(sseModulePath);
const logger = require('../config/logger');

// ─── OpenTelemetry ───
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const tracer = trace.getTracer('agentshield.mcp', '0.1.0');

/**
 * Invoke an MCP agent over SSE transport.
 *
 * Connects to the MCP server's SSE endpoint, lists tools, and either
 * calls the specified tool or returns the tool list.
 *
 * Input formats accepted:
 *   { tool: "toolName", arguments: { ... } }  → calls that tool
 *   { prompt: "..." }                         → lists tools first, calls the first one with the prompt
 *   (any other)                               → lists tools and returns them
 */
async function invokeMcpAgent(endpointUrl, body) {
    return tracer.startActiveSpan('agentshield.mcp.invoke', {
        attributes: {
            'agentshield.mcp.endpoint': endpointUrl,
        },
    }, async (span) => {
        const client = new Client({ name: 'agentshield-gateway', version: '1.0.0' });
        const transport = new SSEClientTransport(new URL(endpointUrl));

        try {
            // Connect and initialize the MCP session
            await tracer.startActiveSpan('agentshield.mcp.connect', async (connectSpan) => {
                try {
                    await client.connect(transport);
                    logger.info(`MCP connected to ${endpointUrl}`);
                    connectSpan.setStatus({ code: SpanStatusCode.OK });
                } catch (err) {
                    connectSpan.recordException(err);
                    connectSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                    throw err;
                } finally {
                    connectSpan.end();
                }
            });

            // List available tools
            let tools;
            await tracer.startActiveSpan('agentshield.mcp.list_tools', async (listSpan) => {
                try {
                    const result = await client.listTools();
                    tools = result.tools;
                    listSpan.setAttribute('agentshield.mcp.tool_count', tools.length);
                    listSpan.setAttribute('agentshield.mcp.tool_names', tools.map(t => t.name).join(', '));
                    logger.debug(`MCP tools available: ${tools.map(t => t.name).join(', ')}`);
                    listSpan.setStatus({ code: SpanStatusCode.OK });
                } catch (err) {
                    listSpan.recordException(err);
                    listSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                    throw err;
                } finally {
                    listSpan.end();
                }
            });

            // Determine what to call
            let callResult = null;

            if (body && body.tool) {
                // Explicit tool call: { tool: "name", arguments: { ... } }
                await tracer.startActiveSpan('agentshield.mcp.call_tool', {
                    attributes: {
                        'agentshield.mcp.tool_name': body.tool,
                        'agentshield.mcp.call_type': 'explicit',
                    },
                }, async (callSpan) => {
                    try {
                        callResult = await client.callTool({
                            name: body.tool,
                            arguments: body.arguments || {},
                        });
                        callSpan.setStatus({ code: SpanStatusCode.OK });
                    } catch (err) {
                        callSpan.recordException(err);
                        callSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                        throw err;
                    } finally {
                        callSpan.end();
                    }
                });
            } else if (body && body.prompt && tools.length > 0) {
                // Prompt mode: try calling the first tool with the prompt as input
                const firstTool = tools[0];
                const args = buildArgsFromPrompt(firstTool, body.prompt);
                await tracer.startActiveSpan('agentshield.mcp.call_tool', {
                    attributes: {
                        'agentshield.mcp.tool_name': firstTool.name,
                        'agentshield.mcp.call_type': 'prompt_auto',
                    },
                }, async (callSpan) => {
                    try {
                        callResult = await client.callTool({
                            name: firstTool.name,
                            arguments: args,
                        });
                        callSpan.setStatus({ code: SpanStatusCode.OK });
                    } catch (err) {
                        callSpan.recordException(err);
                        callSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                        throw err;
                    } finally {
                        callSpan.end();
                    }
                });
            }

            span.setStatus({ code: SpanStatusCode.OK });
            return {
                data: {
                    tools: tools.map(t => ({
                        name: t.name,
                        description: t.description || null,
                        inputSchema: t.inputSchema || null,
                    })),
                    result: callResult || null,
                },
                usage: callResult?._meta?.usage || callResult?.usage || null,
            };
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            throw err;
        } finally {
            // Always disconnect
            try {
                await client.close();
            } catch { /* ignore close errors */ }
            span.end();
        }
    });
}

/**
 * Build tool arguments from a simple prompt string.
 * Inspects the tool's input schema to find a suitable string parameter.
 */
function buildArgsFromPrompt(tool, prompt) {
    const schema = tool.inputSchema || {};
    const properties = schema.properties || {};

    // Look for common string parameter names
    const candidates = ['message', 'prompt', 'query', 'input', 'text', 'content'];
    for (const name of candidates) {
        if (properties[name]) {
            return { [name]: prompt };
        }
    }

    // Fallback: use the first string property
    for (const [name, prop] of Object.entries(properties)) {
        if (prop && prop.type === 'string') {
            return { [name]: prompt };
        }
    }

    // Last resort: pass prompt as-is under "input"
    return { input: prompt };
}

/**
 * Quick health check for an MCP SSE endpoint.
 * Connects, pings, and disconnects. Returns true if reachable.
 */
async function checkMcpHealth(endpointUrl, timeoutMs = 8000) {
    const client = new Client({ name: 'agentshield-healthcheck', version: '1.0.0' });
    const transport = new SSEClientTransport(new URL(endpointUrl));

    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MCP health check timeout')), timeoutMs)
    );

    try {
        await Promise.race([client.connect(transport), timeout]);
        await Promise.race([client.ping(), timeout]);
        return true;
    } catch {
        return false;
    } finally {
        try { await client.close(); } catch { /* ignore */ }
    }
}

module.exports = { invokeMcpAgent, checkMcpHealth };
