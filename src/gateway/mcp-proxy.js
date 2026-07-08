/**
 * MCP Protocol Proxy — Exposes registered MCP agents as native MCP endpoints.
 *
 * Allows MCP clients (Claude Desktop, Cursor, custom agents) to connect to
 * registered upstream MCP agents through AgentShield's governance layer.
 *
 * Route: POST /mcp/:agentSlug
 *
 * Flow:
 *   1. Authenticate caller via X-API-Key or Authorization header
 *   2. Resolve agent from registry by slug
 *   3. Enforce policy, budget, and guardrails (on tool calls)
 *   4. Forward JSON-RPC request to upstream MCP server
 *   5. Audit log the interaction and track cost
 *   6. Return upstream response to the MCP client
 *
 * Supports both SSE and Streamable HTTP upstream transports (auto-detected).
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { RegistryService, AppError } = require('../registry/service');
const auditService = require('../audit/service');
const costService = require('../cost/service');
const policyService = require('../policy/service');
const guardrailsService = require('../guardrails/service');
const apiKeyService = require('../apikeys/service');
const settingsService = require('../settings/service');
const jwt = require('jsonwebtoken');
const config = require('../config');

// MCP Client SDK
const { Client } = require('@modelcontextprotocol/sdk/client');
const { createTransport, isSSEEndpoint } = require('./mcp-client');

// ─── OpenTelemetry ───
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const tracer = trace.getTracer('agentshield.mcp-proxy', '0.1.0');

const router = express.Router();

// ============================================
// Middleware: Parse body as raw JSON-RPC
// ============================================
// Express body-parser is already applied globally, so req.body is available.
// We need to handle both single messages and batches.

// ============================================
// Middleware: Authenticate MCP proxy requests
// ============================================
async function mcpAuthenticate(req, res, next) {
    const span = tracer.startSpan('agentshield.mcp-proxy.authenticate');

    try {
        // Try API Key first (preferred for MCP clients)
        const apiKey = req.headers['x-api-key'];
        if (apiKey) {
            const identity = await apiKeyService.validateKey(apiKey);
            if (!identity) {
                span.setAttribute('agentshield.auth.success', false);
                span.end();
                return sendJsonRpcError(res, req.body?.id || null, -32001, 'Invalid or expired API key', 401);
            }
            req.user = identity;
            req.authMethod = 'api_key';
            span.setAttribute('agentshield.auth.method', 'api_key');
            span.setAttribute('agentshield.auth.success', true);
            span.end();
            return next();
        }

        // Try JWT Bearer token
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, config.jwt.secret);
                req.user = decoded;
                req.authMethod = 'jwt';
                span.setAttribute('agentshield.auth.method', 'jwt');
                span.setAttribute('agentshield.auth.success', true);
                span.end();
                return next();
            } catch (err) {
                span.setAttribute('agentshield.auth.success', false);
                span.end();
                return sendJsonRpcError(res, req.body?.id || null, -32001,
                    err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token', 401);
            }
        }

        // No credentials provided
        span.setAttribute('agentshield.auth.success', false);
        span.end();
        return sendJsonRpcError(res, req.body?.id || null, -32001,
            'Authentication required. Provide X-API-Key header or Authorization: Bearer <token>', 401);
    } catch (err) {
        span.recordException(err);
        span.end();
        return sendJsonRpcError(res, req.body?.id || null, -32603, 'Authentication error', 500);
    }
}

// ============================================
// POST /mcp/:agentSlug — MCP Protocol Proxy
// ============================================
router.post('/:agentSlug', mcpAuthenticate, async (req, res) => {
    const { agentSlug } = req.params;
    const message = req.body;

    // Validate JSON-RPC structure
    if (!message || !message.jsonrpc || message.jsonrpc !== '2.0') {
        return sendJsonRpcError(res, message?.id || null, -32600, 'Invalid JSON-RPC: missing or invalid jsonrpc field');
    }

    const method = message.method;
    const messageId = message.id;
    const traceId = req.traceId || uuidv4();
    req.traceId = traceId;

    return tracer.startActiveSpan('agentshield.mcp-proxy.handle', {
        attributes: {
            'agentshield.mcp-proxy.agent_slug': agentSlug,
            'agentshield.mcp-proxy.method': method || 'notification',
            'agentshield.mcp-proxy.trace_id': traceId,
        },
    }, async (span) => {
        try {
            // ── 1. Resolve Agent ──
            let agent;
            try {
                agent = await RegistryService.getAgent(agentSlug);
            } catch (err) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Agent not found' });
                span.end();
                return sendJsonRpcError(res, messageId, -32002, `Agent "${agentSlug}" not found in registry`, 404);
            }

            if (agent.protocol !== 'mcp') {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Not an MCP agent' });
                span.end();
                return sendJsonRpcError(res, messageId, -32002,
                    `Agent "${agentSlug}" uses protocol "${agent.protocol}", not MCP. Use the REST gateway at /api/v1/gateway/agents/${agentSlug}/invoke instead.`);
            }

            if (!agent.is_active) {
                span.end();
                return sendJsonRpcError(res, messageId, -32002, `Agent "${agent.name}" is currently inactive`);
            }

            if (agent.health_status === 'unhealthy') {
                span.end();
                return sendJsonRpcError(res, messageId, -32002, `Agent "${agent.name}" is currently unhealthy`);
            }

            span.setAttributes({
                'agentshield.agent.name': agent.name,
                'agentshield.agent.endpoint': agent.endpoint_url,
            });

            // ── 2. Handle by Method ──

            // Notifications (no id) — acknowledge silently
            if (messageId === undefined || messageId === null) {
                if (method === 'notifications/initialized') {
                    logger.debug(`MCP proxy: notifications/initialized for ${agentSlug}`);
                }
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return res.status(202).end();
            }

            // Ping — respond directly (no upstream call needed)
            if (method === 'ping') {
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return sendJsonRpcResult(res, messageId, {});
            }

            // Initialize — intercept and combine AgentShield info with upstream capabilities
            if (method === 'initialize') {
                return await handleInitialize(req, res, agent, message, span);
            }

            // ── 3. For tools/list and tools/call — enforce governance, then forward ──

            // Policy enforcement (on tool calls)
            if (method === 'tools/call') {
                const policyAllowed = await enforcePolicyCheck(req, agent, message, span);
                if (!policyAllowed.allowed) {
                    span.setStatus({ code: SpanStatusCode.OK, message: 'Policy denied' });
                    span.end();

                    await auditService.log({
                        traceId,
                        eventType: 'mcp_proxy_policy_denied',
                        actorId: req.user?.id,
                        actorType: req.authMethod === 'api_key' ? 'api_key' : 'user',
                        resourceType: 'agent',
                        resourceId: agent.id,
                        action: `mcp:tools/call:${message.params?.name || 'unknown'}`,
                        outcome: 'denied',
                        details: { reason: policyAllowed.reason, policy: policyAllowed.matchedPolicy },
                        ipAddress: req.ip,
                    }).catch(() => { });

                    return sendJsonRpcError(res, messageId, -32003,
                        `Access denied by policy: ${policyAllowed.reason}`);
                }

                // Guardrail enforcement
                const guardrailResult = await enforceGuardrails(req, agent, message, span);
                if (guardrailResult && !guardrailResult.allowed) {
                    span.end();
                    return sendJsonRpcError(res, messageId, -32004,
                        `Blocked by guardrail: ${guardrailResult.violations.map(v => v.ruleName).join(', ')}`);
                }
            }

            // Budget check (on tool calls)
            if (method === 'tools/call') {
                const budgetOk = await enforceBudgetCheck(req, agent, span);
                if (!budgetOk.allowed) {
                    span.end();
                    return sendJsonRpcError(res, messageId, -32005, `Budget exceeded: ${budgetOk.reason}`);
                }
            }

            // ── 4. Forward to upstream MCP ──
            const startTime = Date.now();
            const upstreamResult = await forwardToUpstreamMcp(agent, message, span);
            const latencyMs = Date.now() - startTime;

            span.setAttribute('agentshield.mcp-proxy.latency_ms', latencyMs);

            // ── 5. Audit & Cost Tracking ──
            const auditAction = method === 'tools/call'
                ? `mcp:tools/call:${message.params?.name || 'unknown'}`
                : `mcp:${method}`;

            auditService.log({
                traceId,
                eventType: 'mcp_proxy_request',
                actorId: req.user?.id,
                actorType: req.authMethod === 'api_key' ? 'api_key' : 'user',
                resourceType: 'agent',
                resourceId: agent.id,
                action: auditAction,
                outcome: 'allowed',
                details: {
                    method,
                    toolName: message.params?.name || null,
                    latencyMs,
                },
                ipAddress: req.ip,
                latencyMs,
            }).catch(() => { });

            // Track cost for tool calls
            if (method === 'tools/call') {
                const inputSize = JSON.stringify(message.params || {});
                const outputSize = JSON.stringify(upstreamResult.result || {});
                costService.recordUsage({
                    traceId,
                    agentId: agent.id,
                    agentSlug: agent.slug,
                    userId: req.user?.id,
                    teamId: req.user?.teamId,
                    department: req.user?.department,
                    inputTokens: costService.estimateTokens(inputSize),
                    outputTokens: costService.estimateTokens(outputSize),
                    costCents: 0,
                    modelName: null,
                    estimated: true,
                }).catch(err => logger.error('MCP proxy cost tracking error:', err));
            }

            // ── 6. Return upstream response ──
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();

            // Set MCP session headers if present
            res.setHeader('Content-Type', 'application/json');
            return res.json(upstreamResult);

        } catch (err) {
            logger.error(`MCP proxy error for ${agentSlug}/${method}:`, err);
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            return sendJsonRpcError(res, messageId, -32603, `Proxy error: ${err.message}`);
        }
    });
});

// ============================================
// GET /mcp/:agentSlug — SSE stream endpoint
// Required by MCP spec for server-initiated notifications
// ============================================
router.get('/:agentSlug', mcpAuthenticate, async (req, res) => {
    // For Streamable HTTP, GET establishes an SSE stream for server-initiated messages.
    // Since we're a stateless proxy, we don't support server push — just acknowledge.
    const { agentSlug } = req.params;
    logger.debug(`MCP proxy: GET SSE stream requested for ${agentSlug} (not supported in proxy mode)`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send a comment to keep the connection alive, then close
    res.write(': agentshield mcp proxy - server push not supported\n\n');

    // Keep alive for a short time, then close
    const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(keepAlive);
    });
});

// ============================================
// DELETE /mcp/:agentSlug — Session termination
// Required by MCP Streamable HTTP spec
// ============================================
router.delete('/:agentSlug', (req, res) => {
    // Stateless proxy — nothing to clean up
    res.status(200).end();
});

// ============================================
// Handlers
// ============================================

/**
 * Handle MCP 'initialize' — respond with AgentShield proxy info + upstream capabilities.
 */
async function handleInitialize(req, res, agent, message, span) {
    const messageId = message.id;
    const client = new Client({ name: 'agentshield-proxy', version: '1.0.0' });
    const transport = createTransport(agent.endpoint_url);

    try {
        await client.connect(transport);

        // Get upstream server capabilities from the connected session
        const serverCapabilities = client.getServerCapabilities() || {};
        const serverInfo = client.getServerVersion() || {};

        span.setAttribute('agentshield.mcp-proxy.upstream_server', serverInfo.name || 'unknown');
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        return sendJsonRpcResult(res, messageId, {
            protocolVersion: message.params?.protocolVersion || '2025-03-26',
            capabilities: {
                tools: serverCapabilities.tools || { listChanged: false },
            },
            serverInfo: {
                name: `AgentShield → ${serverInfo.name || agent.name}`,
                version: serverInfo.version || '1.0.0',
            },
            instructions: `This MCP server is proxied through AgentShield governance firewall. ` +
                `Agent: ${agent.name} (${agent.slug}). ` +
                `All tool calls are subject to policy enforcement, audit logging, and cost tracking.`,
        });
    } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.end();
        return sendJsonRpcError(res, messageId, -32603,
            `Failed to connect to upstream MCP: ${err.message}`);
    } finally {
        try { await client.close(); } catch { }
    }
}

/**
 * Forward a JSON-RPC request to the upstream MCP server.
 */
async function forwardToUpstreamMcp(agent, message, parentSpan) {
    return tracer.startActiveSpan('agentshield.mcp-proxy.forward', {
        attributes: {
            'agentshield.mcp-proxy.upstream_url': agent.endpoint_url,
            'agentshield.mcp-proxy.method': message.method,
        },
    }, async (span) => {
        const client = new Client({ name: 'agentshield-proxy', version: '1.0.0' });
        const transport = createTransport(agent.endpoint_url);

        try {
            await client.connect(transport);

            let result;
            const method = message.method;

            if (method === 'tools/list') {
                const toolsResult = await client.listTools(message.params || {});
                result = {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: toolsResult,
                };
            } else if (method === 'tools/call') {
                const callResult = await client.callTool({
                    name: message.params?.name,
                    arguments: message.params?.arguments || {},
                });
                result = {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: callResult,
                };

                span.setAttribute('agentshield.mcp-proxy.tool_name', message.params?.name || 'unknown');
                span.setAttribute('agentshield.mcp-proxy.tool_error', callResult?.isError || false);
            } else if (method === 'resources/list') {
                const resourcesResult = await client.listResources(message.params || {});
                result = { jsonrpc: '2.0', id: message.id, result: resourcesResult };
            } else if (method === 'resources/read') {
                const readResult = await client.readResource({ uri: message.params?.uri });
                result = { jsonrpc: '2.0', id: message.id, result: readResult };
            } else if (method === 'prompts/list') {
                const promptsResult = await client.listPrompts(message.params || {});
                result = { jsonrpc: '2.0', id: message.id, result: promptsResult };
            } else if (method === 'prompts/get') {
                const promptResult = await client.getPrompt({
                    name: message.params?.name,
                    arguments: message.params?.arguments || {},
                });
                result = { jsonrpc: '2.0', id: message.id, result: promptResult };
            } else if (method === 'completion/complete') {
                // Forward completion requests
                result = {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: { completion: { values: [], hasMore: false, total: 0 } },
                };
            } else {
                // Unknown method — return method not found
                result = {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32601, message: `Method not found: ${method}` },
                };
            }

            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            throw err;
        } finally {
            try { await client.close(); } catch { }
            span.end();
        }
    });
}

// ============================================
// Governance Enforcement Helpers
// ============================================

async function enforcePolicyCheck(req, agent, message, span) {
    try {
        const enabled = await settingsService.getModuleStatus('policies');
        if (!enabled) return { allowed: true };

        const context = {
            user: req.user || {},
            agent: { slug: agent.slug, type: agent.type, name: agent.name, vendor: agent.vendor },
            action: 'invoke',
            request: {
                method: 'POST',
                path: `/mcp/${agent.slug}`,
                timestamp: new Date().toISOString(),
                mcpMethod: message.method,
                mcpToolName: message.params?.name || null,
            },
        };

        const result = await policyService.evaluate(context);
        span.setAttribute('agentshield.mcp-proxy.policy_decision', result.allowed ? 'allow' : 'deny');
        return result;
    } catch (err) {
        logger.error('MCP proxy policy check error (fail-open):', err);
        return { allowed: true };
    }
}

async function enforceGuardrails(req, agent, message, span) {
    try {
        const enabled = await settingsService.getModuleStatus('guardrails');
        if (!enabled) return null;

        // Build a pseudo-body for guardrail evaluation
        const evalBody = {
            tool: message.params?.name,
            arguments: message.params?.arguments || {},
            prompt: JSON.stringify(message.params?.arguments || {}),
        };

        const result = await guardrailsService.evaluateInput(agent.slug, evalBody);
        span.setAttribute('agentshield.mcp-proxy.guardrail_violations', result.violations?.length || 0);

        if (result.violations?.length > 0) {
            auditService.log({
                traceId: req.traceId,
                eventType: 'guardrail_violation',
                actorId: req.user?.id,
                actorType: req.authMethod === 'api_key' ? 'api_key' : 'user',
                resourceType: 'agent',
                action: `mcp:tools/call:${message.params?.name || 'unknown'}`,
                outcome: result.allowed ? 'allowed' : 'denied',
                details: {
                    violations: result.violations.map(v => ({
                        profile: v.profileName,
                        rule: v.ruleName,
                        type: v.ruleType,
                        severity: v.severity,
                    })),
                },
                ipAddress: req.ip,
            }).catch(() => { });
        }

        return result;
    } catch (err) {
        logger.error('MCP proxy guardrail check error (fail-open):', err);
        return null;
    }
}

async function enforceBudgetCheck(req, agent, span) {
    try {
        const enabled = await settingsService.getModuleStatus('cost_management');
        if (!enabled) return { allowed: true };

        const result = await costService.checkBudget(
            req.user?.id,
            req.user?.teamId,
            req.user?.departmentId,
            agent.slug
        );
        span.setAttribute('agentshield.mcp-proxy.budget_decision', result.allowed ? 'allow' : 'deny');
        return result;
    } catch (err) {
        logger.error('MCP proxy budget check error (fail-open):', err);
        return { allowed: true };
    }
}

// ============================================
// JSON-RPC Response Helpers
// ============================================

function sendJsonRpcResult(res, id, result) {
    res.setHeader('Content-Type', 'application/json');
    return res.json({
        jsonrpc: '2.0',
        id,
        result,
    });
}

function sendJsonRpcError(res, id, code, message, httpStatus = 200) {
    // MCP spec: errors should generally be returned as JSON-RPC errors with HTTP 200
    // But auth errors use appropriate HTTP status codes
    const statusCode = httpStatus;
    res.setHeader('Content-Type', 'application/json');
    return res.status(statusCode).json({
        jsonrpc: '2.0',
        id,
        error: {
            code,
            message,
        },
    });
}

module.exports = router;
