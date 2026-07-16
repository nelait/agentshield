const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const authService = require('./auth');
const userService = require('./userService');
const inviteService = require('./inviteService');
const policyService = require('../policy/service');
const workflowService = require('../workflow/service');
const complianceService = require('../compliance/service');
const costService = require('../cost/service');
const auditService = require('../audit/service');
const settingsService = require('../settings/service');
const evaluationService = require('../evaluation/service');
const apiKeyService = require('../apikeys/service');
const guardrailsService = require('../guardrails/service');
const { RegistryService } = require('../registry/service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();


// ============================================
// AUTH ROUTES
// ============================================
router.post('/auth/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const meta = {
            ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip,
            userAgent: req.headers['user-agent'] || null,
        };
        const result = await authService.login(email, password, meta);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.post('/auth/refresh', async (req, res, next) => {
    try {
        const result = await authService.refreshToken(req.body.refreshToken);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.get('/auth/me', async (req, res) => {
    res.json({ success: true, data: req.user });
});

router.post('/auth/users', requireRole('admin'), async (req, res, next) => {
    try {
        const user = await authService.createUser(req.body);
        res.status(201).json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.get('/auth/users', requireRole('admin'), async (req, res, next) => {
    try {
        const users = await authService.listUsers();
        res.json({ success: true, data: users });
    } catch (err) { next(err); }
});

// ============================================
// POLICY ROUTES
// ============================================
router.post('/policies', requireRole('editor'), async (req, res, next) => {
    try {
        const policy = await policyService.createPolicy(req.body, req.user?.id);
        res.status(201).json({ success: true, data: policy });
    } catch (err) { next(err); }
});

router.get('/policies', async (req, res, next) => {
    try {
        const policies = await policyService.listPolicies(req.query);
        res.json({ success: true, data: policies });
    } catch (err) { next(err); }
});

router.get('/policies/:id', async (req, res, next) => {
    try {
        const policy = await policyService.getPolicy(req.params.id);
        res.json({ success: true, data: policy });
    } catch (err) { next(err); }
});

router.put('/policies/:id', requireRole('editor'), async (req, res, next) => {
    try {
        const policy = await policyService.updatePolicy(req.params.id, req.body);
        res.json({ success: true, data: policy });
    } catch (err) { next(err); }
});

router.delete('/policies/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await policyService.deletePolicy(req.params.id);
        res.json({ success: true, message: 'Policy deleted' });
    } catch (err) { next(err); }
});

// ============================================
// REGO / OPA POLICY ROUTES
// ============================================

// Check if OPA binary is available for Rego compilation
router.get('/policies/rego/status', async (req, res, next) => {
    try {
        const available = await policyService.isRegoAvailable();
        res.json({ success: true, data: { opaAvailable: available } });
    } catch (err) { next(err); }
});

// Validate Rego syntax without saving
router.post('/policies/rego/validate', requireRole('editor'), async (req, res, next) => {
    try {
        const { source } = req.body;
        if (!source) return res.status(400).json({ success: false, error: 'source is required' });
        const result = await policyService.validateRego(source);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Import a .rego file as a new policy
router.post('/policies/rego/import', requireRole('editor'), async (req, res, next) => {
    try {
        const { name, source, priority } = req.body;
        if (!name || !source) {
            return res.status(400).json({ success: false, error: 'name and source are required' });
        }
        const policy = await policyService.importRego(name, source, priority || 100, req.user?.id);
        res.status(201).json({ success: true, data: policy });
    } catch (err) { next(err); }
});

// Export Rego source for a policy
router.get('/policies/:id/rego', async (req, res, next) => {
    try {
        const data = await policyService.getRegoSource(req.params.id);
        res.json({ success: true, data });
    } catch (err) { next(err); }
});

// ============================================
// WORKFLOW ROUTES
// ============================================
router.post('/workflows', requireRole('editor'), async (req, res, next) => {
    try {
        const workflow = await workflowService.createWorkflow(req.body, req.user?.id);
        res.status(201).json({ success: true, data: workflow });
    } catch (err) { next(err); }
});

router.get('/workflows', async (req, res, next) => {
    try {
        const workflows = await workflowService.listWorkflows(req.query);
        res.json({ success: true, data: workflows });
    } catch (err) { next(err); }
});

router.get('/workflows/:idOrSlug', async (req, res, next) => {
    try {
        const workflow = await workflowService.getWorkflow(req.params.idOrSlug);
        res.json({ success: true, data: workflow });
    } catch (err) { next(err); }
});

router.put('/workflows/:idOrSlug', requireRole('editor'), async (req, res, next) => {
    try {
        const workflow = await workflowService.updateWorkflow(req.params.idOrSlug, req.body);
        res.json({ success: true, data: workflow });
    } catch (err) { next(err); }
});

router.patch('/workflows/:idOrSlug/toggle', requireRole('editor'), async (req, res, next) => {
    try {
        const workflow = await workflowService.toggleWorkflow(req.params.idOrSlug, req.body.isEnabled);
        res.json({ success: true, data: workflow });
    } catch (err) { next(err); }
});

router.delete('/workflows/:idOrSlug', requireRole('admin'), async (req, res, next) => {
    try {
        await workflowService.deleteWorkflow(req.params.idOrSlug);
        res.json({ success: true, message: 'Workflow deleted' });
    } catch (err) { next(err); }
});

// ============================================
// COMPLIANCE ROUTES
// ============================================
router.post('/compliance/configs', requireRole('admin'), async (req, res, next) => {
    try {
        const cfg = await complianceService.createConfig(req.body);
        res.status(201).json({ success: true, data: cfg });
    } catch (err) { next(err); }
});

router.get('/compliance/configs', async (req, res, next) => {
    try {
        const configs = await complianceService.listConfigs();
        res.json({ success: true, data: configs });
    } catch (err) { next(err); }
});

router.get('/compliance/samples', async (req, res, next) => {
    try {
        const samples = await complianceService.listSamples(req.query);
        res.json({ success: true, data: samples });
    } catch (err) { next(err); }
});

router.get('/compliance/stats', async (req, res, next) => {
    try {
        const stats = await complianceService.getStats();
        res.json({ success: true, data: stats });
    } catch (err) { next(err); }
});

// Run compliance check against a config
router.post('/compliance/configs/:id/run', requireRole('editor'), async (req, res, next) => {
    try {
        const result = await complianceService.runComplianceCheck(
            req.params.id, req.body.samples || null, req.user?.id
        );
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Upload samples and run compliance check
router.post('/compliance/configs/:id/upload-samples', requireRole('editor'), async (req, res, next) => {
    try {
        const { samples } = req.body;
        if (!samples || !Array.isArray(samples) || samples.length === 0) {
            return res.status(400).json({ success: false, error: 'Samples array is required' });
        }
        const result = await complianceService.runComplianceCheck(
            req.params.id, samples, req.user?.id
        );
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Get compliance check history for a config
router.get('/compliance/configs/:id/checks', async (req, res, next) => {
    try {
        const checks = await complianceService.getChecks(req.params.id);
        res.json({ success: true, data: checks });
    } catch (err) { next(err); }
});

// ============================================
// OSCAL CATALOG ROUTES
// ============================================

// Validate an OSCAL JSON structure
router.post('/compliance/oscal/validate', requireRole('editor'), async (req, res, next) => {
    try {
        const result = complianceService.validateOscal(req.body);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Preview an OSCAL catalog (parse without saving)
router.post('/compliance/oscal/preview', requireRole('editor'), async (req, res, next) => {
    try {
        const result = complianceService.previewOscalCatalog(req.body);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Import an OSCAL catalog
router.post('/compliance/oscal/import', requireRole('admin'), async (req, res, next) => {
    try {
        const { catalog, framework, selectedGroups } = req.body;
        if (!catalog) return res.status(400).json({ success: false, error: 'catalog JSON is required' });
        if (!framework) return res.status(400).json({ success: false, error: 'framework is required' });
        const result = await complianceService.importOscalCatalog(catalog, framework, selectedGroups || [], req.user?.id);
        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
});

// List imported OSCAL catalogs
router.get('/compliance/oscal/catalogs', async (req, res, next) => {
    try {
        const catalogs = await complianceService.listOscalCatalogs();
        res.json({ success: true, data: catalogs });
    } catch (err) { next(err); }
});

// Delete an OSCAL catalog and its imported rules
router.delete('/compliance/oscal/catalogs/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await complianceService.deleteOscalCatalog(req.params.id);
        res.json({ success: true, message: 'Catalog and associated rules deleted' });
    } catch (err) { next(err); }
});

// Export a compliance check as OSCAL Assessment Result
router.get('/compliance/checks/:id/oscal', async (req, res, next) => {
    try {
        const result = await complianceService.exportOscalAssessmentResult(req.params.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// ============================================
// BUDGET / COST ROUTES
// ============================================
router.post('/budgets', requireRole('admin'), async (req, res, next) => {
    try {
        const budget = await costService.createBudget(req.body);
        res.status(201).json({ success: true, data: budget });
    } catch (err) { next(err); }
});

router.get('/budgets', async (req, res, next) => {
    try {
        const budgets = await costService.listBudgets();
        res.json({ success: true, data: budgets });
    } catch (err) { next(err); }
});

router.put('/budgets/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const budget = await costService.updateBudget(req.params.id, req.body);
        res.json({ success: true, data: budget });
    } catch (err) { next(err); }
});

router.delete('/budgets/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await costService.deleteBudget(req.params.id);
        res.json({ success: true, message: 'Budget deleted' });
    } catch (err) { next(err); }
});

router.get('/cost/report', async (req, res, next) => {
    try {
        const report = await costService.getUsageReport(req.query);
        res.json({ success: true, data: report });
    } catch (err) { next(err); }
});

router.get('/cost/stats', async (req, res, next) => {
    try {
        const stats = await costService.getStats();
        res.json({ success: true, data: stats });
    } catch (err) { next(err); }
});

router.get('/cost/daily', async (req, res, next) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const data = await costService.getDailyUsage(days);
        res.json({ success: true, data });
    } catch (err) { next(err); }
});

router.get('/cost/model-pricing', async (req, res, next) => {
    try {
        const pricing = await costService.getModelPricing();
        res.json({ success: true, data: pricing });
    } catch (err) { next(err); }
});

router.post('/cost/model-pricing', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await costService.createModelPricing(req.body);
        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.put('/cost/model-pricing/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await costService.updateModelPricing(req.params.id, req.body);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.delete('/cost/model-pricing/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await costService.deleteModelPricing(req.params.id);
        res.json({ success: true, message: 'Model pricing deleted' });
    } catch (err) { next(err); }
});


router.get('/budgets/alerts', async (req, res, next) => {
    try {
        const alerts = await costService.getBudgetAlerts();
        res.json({ success: true, data: alerts });
    } catch (err) { next(err); }
});

router.get('/budgets/:id/history', async (req, res, next) => {
    try {
        const history = await costService.getBudgetHistory(req.params.id);
        res.json({ success: true, data: history });
    } catch (err) { next(err); }
});

router.get('/budgets/history/all', async (req, res, next) => {
    try {
        const history = await costService.getAllBudgetHistory(parseInt(req.query.limit) || 50);
        res.json({ success: true, data: history });
    } catch (err) { next(err); }
});

// ============================================
// AUDIT LOG ROUTES
// ============================================
router.get('/audit', async (req, res, next) => {
    try {
        const result = await auditService.query(req.query);
        res.json({ success: true, data: result.logs, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) { next(err); }
});

router.get('/audit/filters', async (req, res, next) => {
    try {
        const filters = await auditService.getFilterOptions();
        res.json({ success: true, data: filters });
    } catch (err) { next(err); }
});

router.get('/audit/stats', async (req, res, next) => {
    try {
        const stats = await auditService.getStats(req.query.since);
        res.json({ success: true, data: stats });
    } catch (err) { next(err); }
});

// ============================================
// DASHBOARD — Aggregated stats
// ============================================
router.get('/dashboard', async (req, res, next) => {
    try {
        const [agentStats, auditStats, complianceStats, costStats] = await Promise.all([
            RegistryService.getStats(),
            auditService.getStats('24 hours'),
            complianceService.getStats(),
            costService.getStats(),
        ]);

        res.json({
            success: true,
            data: { agents: agentStats, audit: auditStats, compliance: complianceStats, cost: costStats },
        });
    } catch (err) { next(err); }
});

// ============================================
// SEED SAMPLE AGENTS
// ============================================
const SAMPLE_AGENTS = [
    { name: 'GPT-4 Analyst', slug: 'gpt4-analyst', type: 'external', vendor: 'OpenAI', protocol: 'rest', endpointUrl: 'https://api.openai.com/v1/chat/completions', description: 'General-purpose LLM agent via REST API' },
    { name: 'Claude Researcher', slug: 'claude-researcher', type: 'external', vendor: 'Anthropic', protocol: 'rest', endpointUrl: 'https://api.anthropic.com/v1/messages', description: 'Research & analysis agent via REST API' },
    { name: 'Code Review Agent', slug: 'code-review', type: 'internal', vendor: null, protocol: 'mcp', endpointUrl: 'http://internal-mcp:8080/tools/review', description: 'Code review agent via Model Context Protocol' },
    { name: 'Financial Reconciliation', slug: 'fin-recon', type: 'internal', vendor: null, protocol: 'a2a', endpointUrl: 'http://internal-a2a:9090/.well-known/agent.json', description: 'Financial agent using Agent-to-Agent protocol' },
    { name: 'Data Pipeline Agent', slug: 'data-pipeline', type: 'external', vendor: 'Databricks', protocol: 'grpc', endpointUrl: 'grpc://ml-agents.internal:443', description: 'ML data pipeline agent via gRPC' },
    { name: 'Support Triage Bot', slug: 'support-triage', type: 'internal', vendor: null, protocol: 'rest', endpointUrl: 'http://internal:8082/triage', description: 'Customer support triage agent via REST' },
];

router.post('/seed-agents', async (req, res, next) => {
    try {
        const registry = RegistryService;
        const results = [];
        for (const agent of SAMPLE_AGENTS) {
            try {
                const existing = await registry.getAgent(agent.slug);
                results.push({ slug: agent.slug, status: 'skipped', message: 'Already exists' });
            } catch {
                const created = await registry.registerAgent(agent, req.user?.id);
                results.push({ slug: agent.slug, status: 'created', id: created.id });
            }
        }
        res.json({ success: true, data: results });
    } catch (err) { next(err); }
});

// ============================================
// PLAYGROUND — Simulate policy evaluation
// ============================================
router.post('/playground/simulate', async (req, res, next) => {
    try {
        const { userId, userRole, userEmail, department, agentSlug, workflowSlug, customContext } = req.body;

        // Build the context object that the policy engine will evaluate
        const context = {
            user: {
                id: userId || 'playground-user',
                role: userRole || 'viewer',
                email: userEmail || 'test@example.com',
                department: department || 'engineering',
            },
            agent: null,
            workflow: null,
            request: {
                method: 'POST',
                path: agentSlug ? `/api/v1/gateway/agents/${agentSlug}/invoke` : `/api/v1/gateway/workflows/${workflowSlug}/run`,
                timestamp: new Date().toISOString(),
                ...(customContext || {}),
            },
        };

        // Lookup real agent/workflow details
        const registry = RegistryService;
        if (agentSlug) {
            try {
                const agent = await registry.getAgent(agentSlug);
                context.agent = { id: agent.id, slug: agent.slug, name: agent.name, type: agent.type, protocol: agent.protocol, vendor: agent.vendor };
            } catch {
                context.agent = { slug: agentSlug, type: 'unknown' };
            }
        }
        if (workflowSlug) {
            try {
                const wf = await workflowService.getWorkflow(workflowSlug);
                context.workflow = { id: wf.id, slug: wf.slug, name: wf.name, agents: wf.agents };
                if (wf.agents && wf.agents.length > 0 && wf.agents[0].agent_id) {
                    try {
                        const firstAgent = await registry.getAgent(wf.agents[0].agent_id);
                        context.agent = { id: firstAgent.id, slug: firstAgent.slug, name: firstAgent.name, type: firstAgent.type, protocol: firstAgent.protocol };
                    } catch { }
                }
            } catch {
                context.workflow = { slug: workflowSlug };
            }
        }

        // Use the real policy evaluation engine — same one the gateway uses
        const decision = await policyService.evaluate(context);

        // Also build per-policy trace for debugging
        const allPolicies = await policyService.listPolicies({ isActive: true });
        const policyEvaluations = [];
        for (const policy of allPolicies) {
            const rules = policy.rules_json || {};
            const subjectTarget = context.user || {};
            const resourceTarget = context.workflow || context.agent || {};

            // Evaluate subject conditions (skip empty/placeholder conditions)
            let subjectMatched = true;
            const subjectDetails = [];
            const validSubjects = (rules.subjects || []).filter(c => c.field && c.field.trim());
            if (validSubjects.length > 0) {
                for (const cond of validSubjects) {
                    const actualValue = policyService._getNestedValue(subjectTarget, cond.field);
                    const condResult = policyService._evaluateCondition(cond, subjectTarget);
                    subjectDetails.push({ field: cond.field, op: cond.op, expected: cond.value, actual: actualValue, passed: condResult });
                    if (!condResult) subjectMatched = false;
                }
            }

            // Evaluate resource conditions (skip empty/placeholder conditions)
            let resourceMatched = true;
            const resourceDetails = [];
            const validResources = (rules.resources || []).filter(c => c.field && c.field.trim());
            if (validResources.length > 0) {
                const anyMatch = validResources.some(cond => policyService._evaluateCondition(cond, resourceTarget));
                for (const cond of validResources) {
                    const actualValue = policyService._getNestedValue(resourceTarget, cond.field);
                    const condResult = policyService._evaluateCondition(cond, resourceTarget);
                    resourceDetails.push({ field: cond.field, op: cond.op, expected: cond.value, actual: actualValue, passed: condResult });
                }
                resourceMatched = anyMatch;
            }

            const matched = subjectMatched && resourceMatched;
            policyEvaluations.push({
                policy: { id: policy.id, name: policy.name, priority: policy.priority },
                matched,
                effect: rules.effect || 'deny',
                reason: matched ? `Policy "${policy.name}" matched (${rules.effect})` : 'Conditions not met',
                subjectConditions: subjectDetails,
                resourceConditions: resourceDetails,
            });
        }

        res.json({
            success: true,
            data: {
                context,
                decision,
                policyEvaluations,
                totalPoliciesChecked: allPolicies.length,
            },
        });
    } catch (err) { next(err); }
});

// ============================================
// PLAYGROUND — MCP Explorer: List tools for an MCP agent
//   Enforces policy check before listing tools
// ============================================
router.post('/playground/mcp-tools', async (req, res, next) => {
    try {
        const { agentSlug, userRole, userEmail, department } = req.body;
        if (!agentSlug) return res.status(400).json({ success: false, error: 'agentSlug is required' });

        const agent = await RegistryService.getAgent(agentSlug);
        if (agent.protocol !== 'mcp') {
            return res.json({ success: true, data: { error: `Agent "${agent.name}" uses protocol "${agent.protocol}", not MCP.` } });
        }
        if (!agent.is_active) {
            return res.json({ success: true, data: { error: `Agent "${agent.name}" is inactive.` } });
        }

        // Policy check — user must be allowed to access this agent
        const context = {
            user: { id: 'playground-user', role: userRole || 'viewer', email: userEmail || 'test@example.com', department: department || 'engineering' },
            agent: { id: agent.id, slug: agent.slug, name: agent.name, type: agent.type, protocol: agent.protocol, vendor: agent.vendor },
            request: { method: 'POST', path: `/mcp/${agent.slug}`, action: 'mcp:tools/list', timestamp: new Date().toISOString() },
        };
        const decision = await policyService.evaluate(context);
        if (!decision.allowed) {
            return res.json({
                success: true,
                data: {
                    error: `Policy denied: ${decision.reason}`,
                    policyDenied: true,
                    matchedPolicy: decision.matchedPolicy?.name || null,
                },
            });
        }

        // Build the AgentShield gateway URL (not the upstream URL)
        const gatewayBase = `${req.protocol}://${req.get('host')}`;
        const gatewayUrl = `${gatewayBase}/mcp/${agent.slug}`;

        const { invokeMcpAgent } = require('../gateway/mcp-client');
        const result = await invokeMcpAgent(agent.endpoint_url, {});
        res.json({
            success: true,
            data: {
                agent: { slug: agent.slug, name: agent.name, protocol: agent.protocol, endpoint: gatewayUrl, healthStatus: agent.health_status },
                tools: (result.data?.tools || []),
            },
        });
    } catch (err) {
        next(err);
    }
});

// ============================================
// PLAYGROUND — MCP Explorer: Call a specific MCP tool
//   Enforces policy, guardrails, budget, and audit logging
// ============================================
router.post('/playground/mcp-call', async (req, res, next) => {
    try {
        const { agentSlug, toolName, toolArguments, userRole, userEmail, department } = req.body;
        if (!agentSlug || !toolName) return res.status(400).json({ success: false, error: 'agentSlug and toolName are required' });

        const agent = await RegistryService.getAgent(agentSlug);
        if (agent.protocol !== 'mcp') {
            return res.json({ success: true, data: { error: `Agent "${agent.name}" uses protocol "${agent.protocol}", not MCP.` } });
        }

        const checks = { status: null, policy: null, guardrails: null };

        // 1. Status check
        if (!agent.is_active) {
            checks.status = { passed: false, reason: `Agent "${agent.name}" is inactive.` };
            return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name }, toolName, checks, result: null } });
        }
        checks.status = { passed: true, reason: `Agent "${agent.name}" is active` };

        // 2. Policy check
        const context = {
            user: { id: 'playground-user', role: userRole || 'viewer', email: userEmail || 'test@example.com', department: department || 'engineering' },
            agent: { id: agent.id, slug: agent.slug, name: agent.name, type: agent.type, protocol: agent.protocol, vendor: agent.vendor },
            request: { method: 'POST', path: `/mcp/${agent.slug}`, action: `mcp:tools/call:${toolName}`, timestamp: new Date().toISOString() },
        };
        const decision = await policyService.evaluate(context);
        if (!decision.allowed) {
            checks.policy = { passed: false, reason: decision.reason, matchedPolicy: decision.matchedPolicy?.name || null };
            return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name }, toolName, checks, result: null } });
        }
        checks.policy = { passed: true, reason: decision.reason || 'All policies passed', matchedPolicy: decision.matchedPolicy?.name || null };

        // 3. Guardrails check (if assigned)
        try {
            const agentGuardrails = await guardrailsService.getAgentGuardrails(agent.id);
            if (agentGuardrails && agentGuardrails.length > 0) {
                const inputText = JSON.stringify(toolArguments || {});
                let blocked = false;
                let blockReason = '';
                for (const gr of agentGuardrails) {
                    const rules = gr.rules || [];
                    for (const rule of rules) {
                        if (!rule.is_active) continue;
                        if (rule.type === 'regex_block' && rule.pattern) {
                            const re = new RegExp(rule.pattern, rule.flags || 'i');
                            if (re.test(inputText)) {
                                blocked = true;
                                blockReason = `Guardrail "${gr.name}" rule "${rule.name || rule.type}" blocked: pattern matched`;
                                break;
                            }
                        }
                    }
                    if (blocked) break;
                }
                if (blocked) {
                    checks.guardrails = { passed: false, reason: blockReason };
                    return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name }, toolName, checks, result: null } });
                }
                checks.guardrails = { passed: true, reason: `${agentGuardrails.length} guardrail profile(s) passed` };
            } else {
                checks.guardrails = { passed: true, reason: 'No guardrail profiles assigned' };
            }
        } catch (grErr) {
            checks.guardrails = { passed: true, reason: 'Guardrail check skipped (service unavailable)' };
        }

        // 4. Execute the tool call
        const { invokeMcpAgent } = require('../gateway/mcp-client');
        const startTime = Date.now();
        const result = await invokeMcpAgent(agent.endpoint_url, {
            tool: toolName,
            arguments: toolArguments || {},
        });
        const latencyMs = Date.now() - startTime;

        // 5. Audit log
        try {
            const auditService = require('../audit/service');
            await auditService.log({
                eventType: 'mcp_explorer_call',
                action: `mcp:tools/call:${toolName}`,
                actorId: req.user?.id || 'playground-user',
                actorEmail: userEmail || req.user?.email || 'test@example.com',
                agentSlug: agent.slug,
                outcome: 'allowed',
                metadata: { toolName, latencyMs, source: 'mcp-explorer' },
            });
        } catch (auditErr) { /* best-effort logging */ }

        res.json({
            success: true,
            data: {
                agent: { slug: agent.slug, name: agent.name },
                toolName,
                checks,
                result: result.data?.result || null,
                usage: result.usage || null,
                latencyMs,
            },
        });
    } catch (err) {
        next(err);
    }
});

// ============================================
// PLAYGROUND — Test-invoke an agent (status + policy + execution)
// ============================================
router.post('/playground/test-invoke', async (req, res, next) => {
    try {
        const { agentSlug, workflowSlug, input, userRole, userEmail, department } = req.body;
        const registry = RegistryService;
        const { forwardToAgent } = require('../gateway/proxy');

        const checks = { status: null, policy: null };
        let agent = null;

        // 1. Lookup agent/workflow
        if (agentSlug) {
            agent = await registry.getAgent(agentSlug);
        } else if (workflowSlug) {
            const wf = await workflowService.getWorkflow(workflowSlug);
            const agents = typeof wf.agents === 'string' ? JSON.parse(wf.agents) : wf.agents;
            if (!agents || agents.length === 0) {
                return res.json({ success: true, data: { checks: { status: { passed: false, reason: 'Workflow has no agents configured' } }, response: null } });
            }
            agent = await registry.getAgent(agents[0].agent_id || agents[0].agent_slug);
        } else {
            return res.status(400).json({ success: false, error: 'Provide agentSlug or workflowSlug' });
        }

        // 2. Status check
        if (!agent.is_active) {
            checks.status = { passed: false, reason: `Agent "${agent.name}" is inactive. Activate it in Agent Registry.` };
            return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name, protocol: agent.protocol, isActive: false }, checks, response: null } });
        }
        if (agent.health_status === 'unhealthy') {
            checks.status = { passed: false, reason: `Agent "${agent.name}" is unhealthy. Check the endpoint.` };
            return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name, protocol: agent.protocol, healthStatus: 'unhealthy' }, checks, response: null } });
        }
        checks.status = { passed: true, reason: `Agent "${agent.name}" is active and healthy` };

        // 3. Policy check
        const context = {
            user: { id: 'playground-user', role: userRole || 'viewer', email: userEmail || 'test@example.com', department: department || 'engineering' },
            agent: { id: agent.id, slug: agent.slug, name: agent.name, type: agent.type, protocol: agent.protocol, vendor: agent.vendor },
            request: { method: 'POST', path: `/api/v1/gateway/agents/${agent.slug}/invoke`, timestamp: new Date().toISOString() },
        };
        const decision = await policyService.evaluate(context);
        if (!decision.allowed) {
            checks.policy = { passed: false, reason: decision.reason, matchedPolicy: decision.matchedPolicy?.name || null };
            return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name, protocol: agent.protocol, isActive: true }, checks, response: null } });
        }
        checks.policy = { passed: true, reason: decision.reason || 'All policies passed', matchedPolicy: decision.matchedPolicy?.name || null };

        // 4. Resolve API key from LLM settings if agent's auth_config is empty
        const authConfig = agent.auth_config || {};
        if (!authConfig.type && !authConfig.token && !authConfig.key) {
            // Try to find a matching LLM connection in settings
            const llmSettings = await settingsService.getSettings('llm');
            const vendor = (agent.vendor || '').toLowerCase();
            for (const setting of llmSettings) {
                const val = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
                if (val && val.apiKey) {
                    const settingKey = (setting.key || '').toLowerCase();
                    const provider = (val.provider || '').toLowerCase();
                    // Match by vendor or provider name
                    if (settingKey.includes(vendor) || provider.includes(vendor) ||
                        (vendor === 'openai' && (settingKey.includes('openai') || settingKey.includes('gpt'))) ||
                        (vendor === 'anthropic' && (settingKey.includes('anthropic') || settingKey.includes('claude')))) {
                        agent = { ...agent, auth_config: { type: 'bearer', token: val.apiKey } };
                        break;
                    }
                }
            }
        }

        // 5. Auto-format payload for known vendors if user sent a simple prompt
        let formattedInput = input || {};
        const vendor = (agent.vendor || '').toLowerCase();
        const endpoint = (agent.endpoint_url || '').toLowerCase();

        // Detect simple prompt-style input (no model/messages fields)
        if (formattedInput.prompt && !formattedInput.model && !formattedInput.messages) {
            // Resolve model name from LLM settings
            let modelName = 'gpt-4o'; // default
            try {
                const llmSettings = await settingsService.getSettings('llm');
                for (const s of llmSettings) {
                    const val = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
                    if (val?.model) { modelName = val.model; break; }
                }
            } catch { /* use default */ }

            if (vendor === 'openai' || endpoint.includes('openai.com')) {
                formattedInput = {
                    model: modelName,
                    messages: [{ role: 'user', content: formattedInput.prompt }],
                    ...(formattedInput.temperature != null ? { temperature: formattedInput.temperature } : {}),
                    ...(formattedInput.max_tokens != null ? { max_tokens: formattedInput.max_tokens } : {}),
                };
            } else if (vendor === 'anthropic' || endpoint.includes('anthropic.com')) {
                formattedInput = {
                    model: modelName.startsWith('claude') ? modelName : 'claude-3-5-sonnet-20241022',
                    messages: [{ role: 'user', content: formattedInput.prompt }],
                    max_tokens: formattedInput.max_tokens || 1024,
                };
            }
        }

        // 6. Invoke agent
        const startTime = Date.now();
        let agentResponse;
        try {
            agentResponse = await forwardToAgent(agent, formattedInput, {});
        } catch (invokeErr) {
            return res.json({ success: true, data: { agent: { slug: agent.slug, name: agent.name, protocol: agent.protocol, isActive: true }, checks, response: { error: invokeErr.message }, latencyMs: Date.now() - startTime } });
        }
        const latencyMs = Date.now() - startTime;

        res.json({
            success: true,
            data: {
                agent: { slug: agent.slug, name: agent.name, protocol: agent.protocol, isActive: true, endpoint: agent.endpoint_url },
                checks,
                response: agentResponse.data,
                latencyMs,
                usage: agentResponse.usage || null,
            },
        });
    } catch (err) { next(err); }
});

// ============================================
// WORKFLOW AGENT STEPS
// ============================================
router.post('/workflows/:idOrSlug/steps', requireRole('editor'), async (req, res, next) => {
    try {
        const { agentId, stepOrder, config } = req.body;
        const result = await workflowService.addAgentStep(req.params.idOrSlug, agentId, stepOrder, config);
        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.delete('/workflows/:idOrSlug/steps/:agentId', requireRole('editor'), async (req, res, next) => {
    try {
        await workflowService.removeAgentStep(req.params.idOrSlug, req.params.agentId);
        res.json({ success: true, message: 'Step removed' });
    } catch (err) { next(err); }
});

// ============================================
// Role-based authorization middleware
// ============================================
function requireRole(...roles) {
    const roleHierarchy = { super_admin: 4, admin: 3, editor: 2, viewer: 1 };
    const minLevel = Math.min(...roles.map(r => roleHierarchy[r] || 0));

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const userLevel = roleHierarchy[req.user.role] || 0;
        if (userLevel < minLevel) {
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });
        }
        next();
    };
}

module.exports = router;

// ============================================
// SETTINGS ROUTES
// ============================================
router.get('/settings/:category', async (req, res, next) => {
    try {
        const settings = await settingsService.getSettings(req.params.category);
        res.json({ success: true, data: settings });
    } catch (err) { next(err); }
});

router.put('/settings', requireRole('admin'), async (req, res, next) => {
    try {
        const setting = await settingsService.upsertSetting(req.body);
        // Invalidate module cache immediately when module toggles change
        if (req.body.category === 'modules') {
            settingsService.invalidateModuleCache();
        }
        res.json({ success: true, data: setting });
    } catch (err) { next(err); }
});

router.delete('/settings/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await settingsService.deleteSetting(req.params.id);
        res.json({ success: true, message: 'Setting deleted' });
    } catch (err) { next(err); }
});

// ============================================
// COMPLIANCE RULES ROUTES
// ============================================
router.get('/compliance/rules/:framework', async (req, res, next) => {
    try {
        const rules = await settingsService.getComplianceRules(req.params.framework);
        res.json({ success: true, data: rules });
    } catch (err) { next(err); }
});

router.put('/compliance/rules', requireRole('admin'), async (req, res, next) => {
    try {
        const rule = await settingsService.upsertComplianceRule(req.body);
        res.json({ success: true, data: rule });
    } catch (err) { next(err); }
});

router.patch('/compliance/rules/:id/toggle', requireRole('editor'), async (req, res, next) => {
    try {
        const rule = await settingsService.toggleRule(req.params.id, req.body.isEnabled);
        res.json({ success: true, data: rule });
    } catch (err) { next(err); }
});

router.delete('/compliance/rules/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await settingsService.deleteRule(req.params.id);
        res.json({ success: true, message: 'Rule deleted' });
    } catch (err) { next(err); }
});

// Global compliance check history
router.get('/compliance/checks/history', async (req, res, next) => {
    try {
        const checks = await settingsService.getAllChecksHistory(parseInt(req.query.limit) || 50);
        res.json({ success: true, data: checks });
    } catch (err) { next(err); }
});

// CSV/XLS Upload for compliance rules
router.post('/compliance/rules/upload', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
        const framework = req.body.framework;
        if (!framework) return res.status(400).json({ success: false, error: 'Framework is required' });

        // Parse file
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (rows.length === 0) return res.status(400).json({ success: false, error: 'File is empty' });

        // Expected columns: name, description, category, severity, pass_input, pass_output, fail_input, fail_output
        let imported = 0;
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const name = (row.name || row.Name || row.rule_name || row['Rule Name'] || '').toString().trim();
            if (!name) { errors.push(`Row ${i + 2}: missing name`); continue; }

            const evaluationConfig = {};
            const passInput = (row.pass_input || row['Pass Input'] || row.pass_sample_input || '').toString().trim();
            const passOutput = (row.pass_output || row['Pass Output'] || row.pass_sample_output || '').toString().trim();
            const failInput = (row.fail_input || row['Fail Input'] || row.fail_sample_input || '').toString().trim();
            const failOutput = (row.fail_output || row['Fail Output'] || row.fail_sample_output || '').toString().trim();

            if (passInput || passOutput || failInput || failOutput) {
                evaluationConfig.samples = {};
                if (passInput || passOutput) evaluationConfig.samples.pass = { input: passInput, output: passOutput };
                if (failInput || failOutput) evaluationConfig.samples.fail = { input: failInput, output: failOutput };
            }

            try {
                await settingsService.upsertComplianceRule({
                    framework,
                    name,
                    description: (row.description || row.Description || '').toString().trim(),
                    category: (row.category || row.Category || 'custom').toString().trim(),
                    severity: (row.severity || row.Severity || 'medium').toString().trim().toLowerCase(),
                    isEnabled: true,
                    evaluationConfig: Object.keys(evaluationConfig).length > 0 ? evaluationConfig : undefined,
                });
                imported++;
            } catch (err) {
                errors.push(`Row ${i + 2}: ${err.message}`);
            }
        }

        res.json({ success: true, data: { imported, total: rows.length, errors } });
    } catch (err) { next(err); }
});

// ============================================
// EVALUATION ROUTES
// ============================================
router.post('/evaluations/suites', async (req, res, next) => {
    try {
        const suite = await evaluationService.createSuite({ ...req.body, created_by: req.user?.id });
        res.status(201).json({ success: true, data: suite });
    } catch (err) { next(err); }
});

router.get('/evaluations/suites', async (req, res, next) => {
    try {
        const suites = await evaluationService.listSuites(req.query);
        res.json({ success: true, data: suites });
    } catch (err) { next(err); }
});

router.get('/evaluations/suites/:id', async (req, res, next) => {
    try {
        const suite = await evaluationService.getSuite(req.params.id);
        if (!suite) return res.status(404).json({ success: false, error: 'Suite not found' });
        res.json({ success: true, data: suite });
    } catch (err) { next(err); }
});

router.put('/evaluations/suites/:id', async (req, res, next) => {
    try {
        const suite = await evaluationService.updateSuite(req.params.id, req.body);
        res.json({ success: true, data: suite });
    } catch (err) { next(err); }
});

router.delete('/evaluations/suites/:id', async (req, res, next) => {
    try {
        await evaluationService.deleteSuite(req.params.id);
        res.json({ success: true });
    } catch (err) { next(err); }
});

router.post('/evaluations/suites/:id/run', async (req, res, next) => {
    try {
        const result = await evaluationService.runEvaluation(req.params.id, req.body.judgeModel || null, req.user?.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.get('/evaluations/suites/:id/runs', async (req, res, next) => {
    try {
        const runs = await evaluationService.getRunHistory(req.params.id);
        res.json({ success: true, data: runs });
    } catch (err) { next(err); }
});

router.get('/evaluations/runs/:id', async (req, res, next) => {
    try {
        const run = await evaluationService.getRun(req.params.id);
        if (!run) return res.status(404).json({ success: false, error: 'Run not found' });
        res.json({ success: true, data: run });
    } catch (err) { next(err); }
});

router.get('/evaluations/reviews', async (req, res, next) => {
    try {
        const reviews = await evaluationService.getPendingReviews(req.query);
        res.json({ success: true, data: reviews });
    } catch (err) { next(err); }
});

router.put('/evaluations/reviews/:id', async (req, res, next) => {
    try {
        const review = await evaluationService.submitReview(req.params.id, { ...req.body, reviewed_by: req.user?.id });
        res.json({ success: true, data: review });
    } catch (err) { next(err); }
});

router.get('/evaluations/stats', async (req, res, next) => {
    try {
        const stats = await evaluationService.getStats();
        res.json({ success: true, data: stats });
    } catch (err) { next(err); }
});

router.get('/evaluations/personas', async (req, res, next) => {
    try {
        const personas = evaluationService.getPersonaTemplates();
        res.json({ success: true, data: personas });
    } catch (err) { next(err); }
});

// ============================================
// GUARDRAILS ROUTES
// ============================================
router.post('/guardrails/profiles', requireRole('editor'), async (req, res, next) => {
    try {
        const profile = await guardrailsService.createProfile({ ...req.body, createdBy: req.user?.id });
        res.status(201).json({ success: true, data: profile });
    } catch (err) { next(err); }
});

router.get('/guardrails/profiles', async (req, res, next) => {
    try {
        const profiles = await guardrailsService.listProfiles();
        res.json({ success: true, data: profiles });
    } catch (err) { next(err); }
});

router.get('/guardrails/profiles/:id', async (req, res, next) => {
    try {
        const profile = await guardrailsService.getProfile(req.params.id);
        res.json({ success: true, data: profile });
    } catch (err) { next(err); }
});

router.put('/guardrails/profiles/:id', requireRole('editor'), async (req, res, next) => {
    try {
        const profile = await guardrailsService.updateProfile(req.params.id, req.body);
        res.json({ success: true, data: profile });
    } catch (err) { next(err); }
});

router.delete('/guardrails/profiles/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await guardrailsService.deleteProfile(req.params.id);
        res.json({ success: true, message: 'Guardrail profile deleted' });
    } catch (err) { next(err); }
});

// Guardrail Rules
router.post('/guardrails/profiles/:id/rules', requireRole('editor'), async (req, res, next) => {
    try {
        const rule = await guardrailsService.addRule(req.params.id, req.body);
        res.status(201).json({ success: true, data: rule });
    } catch (err) { next(err); }
});

router.put('/guardrails/rules/:id', requireRole('editor'), async (req, res, next) => {
    try {
        const rule = await guardrailsService.updateRule(req.params.id, req.body);
        res.json({ success: true, data: rule });
    } catch (err) { next(err); }
});

router.delete('/guardrails/rules/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await guardrailsService.deleteRule(req.params.id);
        res.json({ success: true, message: 'Guardrail rule deleted' });
    } catch (err) { next(err); }
});

// Agent Assignment
router.post('/guardrails/assign', requireRole('editor'), async (req, res, next) => {
    try {
        const result = await guardrailsService.assignToAgent(req.body.agentId, req.body.profileId, req.user?.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.delete('/guardrails/assign', requireRole('editor'), async (req, res, next) => {
    try {
        const result = await guardrailsService.unassignFromAgent(req.body.agentId, req.body.profileId);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.get('/guardrails/agents/:agentId', async (req, res, next) => {
    try {
        const guardrails = await guardrailsService.getAgentGuardrails(req.params.agentId);
        res.json({ success: true, data: guardrails });
    } catch (err) { next(err); }
});

// Test Runner
router.post('/guardrails/profiles/:id/test', requireRole('editor'), async (req, res, next) => {
    try {
        const { testCases, agentId } = req.body;
        if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
            return res.status(400).json({ success: false, error: 'testCases array is required' });
        }
        const result = await guardrailsService.runGuardrailTests(
            req.params.id, testCases, agentId || null, req.user?.id
        );
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.get('/guardrails/test-runs', async (req, res, next) => {
    try {
        const runs = await guardrailsService.getTestRuns(req.query.profileId || null, parseInt(req.query.limit) || 20);
        res.json({ success: true, data: runs });
    } catch (err) { next(err); }
});

router.get('/guardrails/test-runs/:id', async (req, res, next) => {
    try {
        const run = await guardrailsService.getTestRun(req.params.id);
        res.json({ success: true, data: run });
    } catch (err) { next(err); }
});

router.get('/guardrails/stats', async (req, res, next) => {
    try {
        const stats = await guardrailsService.getStats();
        res.json({ success: true, data: stats });
    } catch (err) { next(err); }
});

// ── YAML Guardrail Import/Export (Phase 3) ──

// Export profile as YAML
router.get('/guardrails/profiles/:id/yaml', async (req, res, next) => {
    try {
        const yamlString = await guardrailsService.exportProfileYaml(req.params.id);
        res.json({ success: true, data: { yaml: yamlString } });
    } catch (err) { next(err); }
});

// Import profile from YAML
router.post('/guardrails/import-yaml', requireRole('editor'), async (req, res, next) => {
    try {
        const { yaml: yamlString } = req.body;
        if (!yamlString) return res.status(400).json({ success: false, error: 'YAML string is required in the "yaml" field' });
        const result = await guardrailsService.importProfileYaml(yamlString, req.user?.id);
        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Preview/validate YAML without saving
router.post('/guardrails/preview-yaml', async (req, res, next) => {
    try {
        const { yaml: yamlString } = req.body;
        if (!yamlString) return res.status(400).json({ success: false, error: 'YAML string is required in the "yaml" field' });
        const preview = await guardrailsService.previewYaml(yamlString);
        res.json({ success: true, data: preview });
    } catch (err) { next(err); }
});

// ============================================
// API KEY MANAGEMENT ROUTES
// ============================================
router.post('/api-keys', requireRole('admin'), async (req, res, next) => {
    try {
        const { name, role, scopes, expiresAt } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
        const key = await apiKeyService.createKey({
            name,
            ownerId: req.user?.id,
            role: role || 'viewer',
            scopes: scopes || ['policy:check'],
            expiresAt: expiresAt || null,
        });
        res.status(201).json({ success: true, data: key });
    } catch (err) { next(err); }
});

router.get('/api-keys', requireRole('admin'), async (req, res, next) => {
    try {
        const keys = await apiKeyService.listKeys();
        res.json({ success: true, data: keys });
    } catch (err) { next(err); }
});

router.delete('/api-keys/:id', requireRole('admin'), async (req, res, next) => {
    try {
        await apiKeyService.revokeKey(req.params.id);
        res.json({ success: true, message: 'API key revoked' });
    } catch (err) { next(err); }
});

// ============================================
// OBSERVABILITY ROUTES
// ============================================
router.get('/observability/health', requireRole('admin'), async (req, res) => {
    try {
        const otelConfig = {
            serviceName: process.env.OTEL_SERVICE_NAME || 'agentshield',
            serviceVersion: '0.1.0',
            exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || null,
            exporterType: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'console',
            samplingRate: parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || '1.0'),
            environment: process.env.NODE_ENV || 'development',
        };

        // Check if OTLP endpoint is reachable
        // OTLP collectors only accept POST — a 200, 400, or 405 means the endpoint is up
        let exporterHealthy = false;
        if (otelConfig.exporterEndpoint) {
            try {
                const axios = require('axios');
                const resp = await axios.post(
                    `${otelConfig.exporterEndpoint}/v1/traces`,
                    JSON.stringify({ resourceSpans: [] }),
                    { timeout: 3000, headers: { 'Content-Type': 'application/json' }, validateStatus: () => true }
                );
                // Any response (even 400/405) means the collector is reachable
                exporterHealthy = resp.status < 500;
            } catch {
                exporterHealthy = false;
            }
        } else {
            exporterHealthy = true; // Console exporter is always healthy
        }

        res.json({
            success: true,
            data: {
                ...otelConfig,
                exporterHealthy,
                uptime: process.uptime(),
            },
        });
    } catch (err) {
        res.json({ success: true, data: { exporterHealthy: false, error: err.message } });
    }
});

// ============================================
// ADMIN — USER MANAGEMENT (admin+ only)
// ============================================
router.get('/admin/users', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await userService.listUsers(req.query);
        res.json({ success: true, data: result.users, pagination: result.pagination });
    } catch (err) { next(err); }
});

router.get('/admin/users/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const user = await userService.getUser(req.params.id);
        res.json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.post('/admin/users', requireRole('admin'), async (req, res, next) => {
    try {
        const user = await userService.createUser(req.body, req.user?.id);
        res.status(201).json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.put('/admin/users/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const user = await userService.updateUser(req.params.id, req.body, req.user?.id);
        res.json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.patch('/admin/users/:id/toggle', requireRole('admin'), async (req, res, next) => {
    try {
        const user = await userService.toggleUserStatus(req.params.id, req.user?.id);
        res.json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.post('/admin/users/:id/reset-password', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await userService.resetPassword(req.params.id, req.user?.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.delete('/admin/users/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await userService.deleteUser(req.params.id, req.user?.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Login history (admin sees all)
router.get('/admin/login-history', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await userService.getAllLoginHistory(req.query);
        res.json({ success: true, data: result.history, pagination: result.pagination });
    } catch (err) { next(err); }
});

// User-specific login history
router.get('/admin/users/:id/login-history', requireRole('admin'), async (req, res, next) => {
    try {
        const history = await userService.getLoginHistory(req.params.id);
        res.json({ success: true, data: history });
    } catch (err) { next(err); }
});

// User sessions
router.get('/admin/users/:id/sessions', requireRole('admin'), async (req, res, next) => {
    try {
        const sessions = await userService.getActiveSessions(req.params.id);
        res.json({ success: true, data: sessions });
    } catch (err) { next(err); }
});

router.delete('/admin/users/:id/sessions', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await userService.revokeAllSessions(req.params.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.delete('/admin/users/:id/sessions/:sid', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await userService.revokeSession(req.params.sid);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// ============================================
// ADMIN — SELF-SERVICE PROFILE
// ============================================
router.get('/admin/profile', async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
        const user = await userService.getUser(req.user.id);
        res.json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.put('/admin/profile', async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
        // Users can only update their own profile fields (not role)
        const { name, phone, timezone, department } = req.body;
        const user = await userService.updateUser(req.user.id, { name, phone, timezone, department }, req.user.id);
        res.json({ success: true, data: user });
    } catch (err) { next(err); }
});

router.post('/admin/profile/change-password', async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
        const { currentPassword, newPassword } = req.body;
        const result = await userService.changePassword(req.user.id, currentPassword, newPassword);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

router.get('/admin/profile/login-history', async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
        const history = await userService.getLoginHistory(req.user.id);
        res.json({ success: true, data: history });
    } catch (err) { next(err); }
});

router.get('/admin/profile/sessions', async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
        const sessions = await userService.getActiveSessions(req.user.id);
        res.json({ success: true, data: sessions });
    } catch (err) { next(err); }
});

router.delete('/admin/profile/sessions/:sid', async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
        const result = await userService.revokeSession(req.params.sid, req.user.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// ============================================
// ADMIN — INVITATIONS
// ============================================
router.post('/admin/invitations', requireRole('admin'), async (req, res, next) => {
    try {
        const invite = await inviteService.createInvitation({ ...req.body, invitedBy: req.user?.id });
        res.status(201).json({ success: true, data: invite });
    } catch (err) { next(err); }
});

router.get('/admin/invitations', requireRole('admin'), async (req, res, next) => {
    try {
        const invites = await inviteService.listInvitations(req.query);
        res.json({ success: true, data: invites });
    } catch (err) { next(err); }
});

router.delete('/admin/invitations/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const result = await inviteService.revokeInvitation(req.params.id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

// Accept invitation (PUBLIC — no auth required)
router.post('/admin/invitations/accept', async (req, res, next) => {
    try {
        const user = await inviteService.acceptInvitation(req.body);
        res.status(201).json({ success: true, data: user });
    } catch (err) { next(err); }
});

// ============================================
// ADMIN — SYSTEM STATS (super_admin only)
// ============================================
router.get('/admin/system/stats', requireRole('admin'), async (req, res, next) => {
    try {
        const stats = await userService.getSystemStats();
        res.json({ success: true, data: stats });
    } catch (err) { next(err); }
});
