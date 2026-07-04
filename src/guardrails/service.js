const db = require('../db');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

// ============================================
// Guardrails Service
// ============================================
class GuardrailsService {

    // ─── Profile CRUD ───────────────────────────

    async createProfile(data) {
        const { name, description, mode, createdBy } = data;

        // Enforce unique profile name
        const existing = await db.query(
            'SELECT id FROM guardrail_profiles WHERE LOWER(name) = LOWER($1)',
            [name]
        );
        if (existing.rows.length > 0) {
            const err = new Error(`A guardrail profile named "${name}" already exists. Please choose a unique name.`);
            err.statusCode = 409;
            err.isOperational = true;
            throw err;
        }

        const result = await db.query(
            `INSERT INTO guardrail_profiles (name, description, mode, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name, description || null, mode || 'block', createdBy || null]
        );
        logger.info(`Guardrail profile created: ${name}`);
        return result.rows[0];
    }

    async listProfiles() {
        const result = await db.query(`
            SELECT gp.*,
                   COALESCE(rc.rule_count, 0) AS rule_count,
                   COALESCE(ac.agent_count, 0) AS agent_count
            FROM guardrail_profiles gp
            LEFT JOIN (SELECT profile_id, COUNT(*) AS rule_count FROM guardrail_rules GROUP BY profile_id) rc ON rc.profile_id = gp.id
            LEFT JOIN (SELECT profile_id, COUNT(*) AS agent_count FROM agent_guardrails GROUP BY profile_id) ac ON ac.profile_id = gp.id
            ORDER BY gp.created_at DESC
        `);
        return result.rows;
    }

    async getProfile(id) {
        const profileResult = await db.query('SELECT * FROM guardrail_profiles WHERE id = $1', [id]);
        if (profileResult.rows.length === 0) throw new Error('Guardrail profile not found');
        const profile = profileResult.rows[0];

        const rulesResult = await db.query(
            'SELECT * FROM guardrail_rules WHERE profile_id = $1 ORDER BY sort_order ASC, created_at ASC',
            [id]
        );
        profile.rules = rulesResult.rows;

        // Get assigned agents
        const agentsResult = await db.query(`
            SELECT a.id, a.name, a.slug, a.vendor, a.protocol, a.health_status, a.is_active, ag.assigned_at
            FROM agent_guardrails ag
            JOIN agents a ON a.id = ag.agent_id
            WHERE ag.profile_id = $1
            ORDER BY a.name ASC
        `, [id]);
        profile.assigned_agents = agentsResult.rows;

        return profile;
    }

    async updateProfile(id, data) {
        const allowed = ['name', 'description', 'mode', 'is_active'];
        const setClauses = [];
        const params = [];
        let idx = 1;

        // If name is being updated, enforce uniqueness
        if (data.name) {
            const existing = await db.query(
                'SELECT id FROM guardrail_profiles WHERE LOWER(name) = LOWER($1) AND id != $2',
                [data.name, id]
            );
            if (existing.rows.length > 0) {
                const err = new Error(`A guardrail profile named "${data.name}" already exists. Please choose a unique name.`);
                err.statusCode = 409;
                err.isOperational = true;
                throw err;
            }
        }

        for (const [key, value] of Object.entries(data)) {
            const dbKey = key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
            if (allowed.includes(dbKey)) {
                setClauses.push(`${dbKey} = $${idx++}`);
                params.push(value);
            }
        }

        if (setClauses.length === 0) return this.getProfile(id);
        setClauses.push('updated_at = NOW()');
        params.push(id);

        const result = await db.query(
            `UPDATE guardrail_profiles SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );
        if (result.rows.length === 0) throw new Error('Guardrail profile not found');
        logger.info(`Guardrail profile updated: ${id}`);
        return result.rows[0];
    }

    async deleteProfile(id) {
        const result = await db.query('DELETE FROM guardrail_profiles WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) throw new Error('Guardrail profile not found');
        logger.info(`Guardrail profile deleted: ${id}`);
    }

    // ─── Rule CRUD ──────────────────────────────

    async addRule(profileId, data) {
        const { name, description, ruleType, scope, config, severity, sortOrder } = data;

        // Verify profile exists
        const profile = await db.query('SELECT id FROM guardrail_profiles WHERE id = $1', [profileId]);
        if (profile.rows.length === 0) throw new Error('Guardrail profile not found');

        const result = await db.query(
            `INSERT INTO guardrail_rules (profile_id, name, description, rule_type, scope, config, severity, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                profileId, name, description || null,
                ruleType, scope || 'both',
                JSON.stringify(config || {}),
                severity || 'high',
                sortOrder || 0,
            ]
        );
        logger.info(`Guardrail rule added: ${name} → profile ${profileId}`);
        return result.rows[0];
    }

    async updateRule(ruleId, data) {
        const allowed = ['name', 'description', 'rule_type', 'scope', 'config', 'severity', 'is_enabled', 'sort_order'];
        const setClauses = [];
        const params = [];
        let idx = 1;

        for (const [key, value] of Object.entries(data)) {
            const dbKey = key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
            if (allowed.includes(dbKey)) {
                setClauses.push(`${dbKey} = $${idx++}`);
                params.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
            }
        }

        if (setClauses.length === 0) return null;
        params.push(ruleId);

        const result = await db.query(
            `UPDATE guardrail_rules SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );
        if (result.rows.length === 0) throw new Error('Guardrail rule not found');
        return result.rows[0];
    }

    async deleteRule(ruleId) {
        const result = await db.query('DELETE FROM guardrail_rules WHERE id = $1 RETURNING id', [ruleId]);
        if (result.rows.length === 0) throw new Error('Guardrail rule not found');
    }

    // ─── Agent Assignment ───────────────────────

    async assignToAgent(agentId, profileId, assignedBy = null) {
        // Verify both exist
        const agent = await db.query('SELECT id, name FROM agents WHERE id = $1', [agentId]);
        if (agent.rows.length === 0) throw new Error('Agent not found');
        const profile = await db.query('SELECT id, name FROM guardrail_profiles WHERE id = $1', [profileId]);
        if (profile.rows.length === 0) throw new Error('Guardrail profile not found');

        await db.query(
            `INSERT INTO agent_guardrails (agent_id, profile_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, profile_id) DO NOTHING`,
            [agentId, profileId, assignedBy]
        );
        logger.info(`Guardrail profile "${profile.rows[0].name}" assigned to agent "${agent.rows[0].name}"`);
        return { agentId, profileId, assigned: true };
    }

    async unassignFromAgent(agentId, profileId) {
        await db.query(
            'DELETE FROM agent_guardrails WHERE agent_id = $1 AND profile_id = $2',
            [agentId, profileId]
        );
        return { agentId, profileId, unassigned: true };
    }

    async getAgentGuardrails(agentId) {
        const result = await db.query(`
            SELECT gp.*, ag.assigned_at,
                   (SELECT COUNT(*) FROM guardrail_rules gr WHERE gr.profile_id = gp.id AND gr.is_enabled = true) AS active_rule_count
            FROM agent_guardrails ag
            JOIN guardrail_profiles gp ON gp.id = ag.profile_id
            WHERE ag.agent_id = $1 AND gp.is_active = true
            ORDER BY gp.name ASC
        `, [agentId]);
        return result.rows;
    }

    // ─── Runtime Enforcement ────────────────────

    /**
     * Evaluate input payload against all active guardrails for an agent.
     * Returns { allowed, violations[], sanitized }
     */
    async evaluateInput(agentIdOrSlug, payload) {
        return this._evaluate(agentIdOrSlug, payload, 'input');
    }

    /**
     * Evaluate output payload against all active guardrails for an agent.
     * Returns { allowed, violations[], sanitized }
     */
    async evaluateOutput(agentIdOrSlug, payload) {
        return this._evaluate(agentIdOrSlug, payload, 'output');
    }

    async _evaluate(agentIdOrSlug, payload, direction) {
        const violations = [];
        let blocked = false;

        // Resolve agent ID
        let agentId = agentIdOrSlug;
        if (!this._isUUID(agentIdOrSlug)) {
            const agentResult = await db.query('SELECT id FROM agents WHERE slug = $1', [agentIdOrSlug]);
            if (agentResult.rows.length === 0) return { allowed: true, violations: [], sanitized: null };
            agentId = agentResult.rows[0].id;
        }

        // Get active guardrail profiles for this agent
        const profiles = await this.getAgentGuardrails(agentId);
        if (profiles.length === 0) return { allowed: true, violations: [], sanitized: null };

        // Extract text content from payload
        const text = this._extractText(payload);
        if (!text) return { allowed: true, violations: [], sanitized: null };

        for (const profile of profiles) {
            // Get enabled rules matching this direction
            const rulesResult = await db.query(
                `SELECT * FROM guardrail_rules
                 WHERE profile_id = $1 AND is_enabled = true AND (scope = $2 OR scope = 'both')
                 ORDER BY sort_order ASC`,
                [profile.id, direction]
            );

            for (const rule of rulesResult.rows) {
                const result = this._evaluateRule(rule, text);
                if (result.triggered) {
                    violations.push({
                        profileId: profile.id,
                        profileName: profile.name,
                        ruleId: rule.id,
                        ruleName: rule.name,
                        ruleType: rule.rule_type,
                        severity: rule.severity,
                        details: result.details,
                        direction,
                    });

                    // In block mode, a critical/high severity violation blocks the request
                    if (profile.mode === 'block' && (rule.severity === 'critical' || rule.severity === 'high')) {
                        blocked = true;
                    }
                }
            }
        }

        return {
            allowed: !blocked,
            violations,
            sanitized: null, // Future: sanitized payload with PII masked
        };
    }

    // ─── Rule Evaluators ────────────────────────

    _evaluateRule(rule, text) {
        const config = typeof rule.config === 'string' ? JSON.parse(rule.config) : (rule.config || {});

        switch (rule.rule_type) {
            case 'content_filter':
                return this._evaluateContentFilter(config, text);
            case 'pii_shield':
                return this._evaluatePiiShield(config, text);
            case 'prompt_injection':
                return this._evaluatePromptInjection(config, text);
            case 'topic_boundary':
                return this._evaluateTopicBoundary(config, text);
            case 'token_limit':
                return this._evaluateTokenLimit(config, text);
            case 'custom_regex':
                return this._evaluateCustomRegex(config, text);
            case 'output_format':
                return this._evaluateOutputFormat(config, text);
            case 'llm_judge':
                // LLM judge is async — for real-time we skip it; for test runs we call it
                return { triggered: false, details: 'LLM judge skipped in real-time mode' };
            default:
                return { triggered: false, details: 'Unknown rule type' };
        }
    }

    /**
     * Content Filter: Block/flag messages containing specified keywords or phrases.
     * Config: { keywords: string[], caseSensitive: boolean }
     */
    _evaluateContentFilter(config, text) {
        const keywords = config.keywords || [];
        if (keywords.length === 0) return { triggered: false, details: 'No keywords configured' };

        const searchText = config.caseSensitive ? text : text.toLowerCase();
        const matched = [];

        for (const keyword of keywords) {
            const searchKeyword = config.caseSensitive ? keyword : keyword.toLowerCase();
            if (searchText.includes(searchKeyword)) {
                matched.push(keyword);
            }
        }

        if (matched.length > 0) {
            return { triggered: true, details: `Blocked keywords found: ${matched.join(', ')}` };
        }
        return { triggered: false, details: 'No blocked keywords found' };
    }

    /**
     * PII Shield: Detect sensitive data patterns (SSN, credit card, email, phone).
     * Config: { patterns: string[] } — defaults to all standard patterns
     */
    _evaluatePiiShield(config, text) {
        const defaultPatterns = {
            ssn: { label: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
            credit_card: { label: 'Credit Card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/ },
            email: { label: 'Email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
            phone: { label: 'Phone', regex: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
            dob: { label: 'Date of Birth', regex: /\b(?:DOB|date of birth|born on)[:\s]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/i },
            mrn: { label: 'Medical Record Number', regex: /\bMRN[-\s]?\d{4,10}\b/i },
        };

        const activePatterns = config.patterns && config.patterns.length > 0
            ? config.patterns
            : Object.keys(defaultPatterns);

        const detected = [];
        for (const key of activePatterns) {
            const pattern = defaultPatterns[key];
            if (pattern && pattern.regex.test(text)) {
                detected.push(pattern.label);
            }
        }

        // Also check custom patterns from config
        if (config.customPatterns && Array.isArray(config.customPatterns)) {
            for (const cp of config.customPatterns) {
                try {
                    const regex = new RegExp(cp.pattern, cp.flags || 'i');
                    if (regex.test(text)) {
                        detected.push(cp.label || 'Custom PII');
                    }
                } catch { /* skip invalid regex */ }
            }
        }

        if (detected.length > 0) {
            return { triggered: true, details: `PII detected: ${detected.join(', ')}` };
        }
        return { triggered: false, details: 'No PII detected' };
    }

    /**
     * Prompt Injection Detection: Catch common injection/jailbreak attempts.
     * Config: { extraPatterns: string[] }
     */
    _evaluatePromptInjection(config, text) {
        const injectionPatterns = [
            /ignore\s+(all\s+)?previous\s+instructions/i,
            /ignore\s+(all\s+)?prior\s+instructions/i,
            /disregard\s+(all\s+)?(previous|prior|above)\s+/i,
            /forget\s+(all\s+)?(previous|prior|your)\s+/i,
            /you\s+are\s+now\s+(a|an)\s+/i,
            /pretend\s+(you\s+are|to\s+be)\s+/i,
            /act\s+as\s+(a|an|if)\s+/i,
            /reveal\s+(your|the)\s+(system|original)\s+prompt/i,
            /show\s+(me\s+)?(your|the)\s+system\s+prompt/i,
            /what\s+(is|are)\s+your\s+(system\s+)?instructions/i,
            /output\s+(your|the)\s+(initial|system)\s+/i,
            /\bDAN\b.*\bmode\b/i,
            /developer\s+mode\s+(enabled|on|activate)/i,
            /jailbreak/i,
            /bypass\s+(safety|content|filter|guardrail)/i,
        ];

        // Add extra patterns from config
        if (config.extraPatterns && Array.isArray(config.extraPatterns)) {
            for (const pattern of config.extraPatterns) {
                try {
                    injectionPatterns.push(new RegExp(pattern, 'i'));
                } catch { /* skip invalid regex */ }
            }
        }

        const matched = [];
        for (const pattern of injectionPatterns) {
            if (pattern.test(text)) {
                matched.push(pattern.source.substring(0, 40));
            }
        }

        if (matched.length > 0) {
            return { triggered: true, details: `Prompt injection detected (${matched.length} pattern${matched.length > 1 ? 's' : ''} matched)` };
        }
        return { triggered: false, details: 'No injection patterns detected' };
    }

    /**
     * Topic Boundary: Keyword-based topic enforcement.
     * Config: { allowedTopics: string[], blockedTopics: string[] }
     */
    _evaluateTopicBoundary(config, text) {
        const lowerText = text.toLowerCase();

        // Check blocked topics first
        if (config.blockedTopics && config.blockedTopics.length > 0) {
            const blockedFound = config.blockedTopics.filter(t => lowerText.includes(t.toLowerCase()));
            if (blockedFound.length > 0) {
                return { triggered: true, details: `Blocked topics found: ${blockedFound.join(', ')}` };
            }
        }

        // If allowedTopics is specified, ensure at least one is present
        if (config.allowedTopics && config.allowedTopics.length > 0) {
            const allowedFound = config.allowedTopics.some(t => lowerText.includes(t.toLowerCase()));
            if (!allowedFound) {
                return { triggered: true, details: `Content does not match any allowed topics: ${config.allowedTopics.join(', ')}` };
            }
        }

        return { triggered: false, details: 'Topic boundaries respected' };
    }

    /**
     * Token Limit: Approximate token count enforcement.
     * Config: { maxTokens: number }
     */
    _evaluateTokenLimit(config, text) {
        const maxTokens = config.maxTokens || 4096;
        // Approximate: 1 token ≈ 4 characters (conservative estimate)
        const estimatedTokens = Math.ceil(text.length / 4);

        if (estimatedTokens > maxTokens) {
            return { triggered: true, details: `Estimated ${estimatedTokens} tokens exceeds limit of ${maxTokens}` };
        }
        return { triggered: false, details: `Estimated ${estimatedTokens} tokens (limit: ${maxTokens})` };
    }

    /**
     * Custom Regex: User-defined regex patterns.
     * Config: { patterns: [{ pattern: string, flags: string, label: string }] }
     */
    _evaluateCustomRegex(config, text) {
        const patterns = config.patterns || [];
        if (patterns.length === 0) return { triggered: false, details: 'No patterns configured' };

        const matched = [];
        for (const p of patterns) {
            try {
                const regex = new RegExp(p.pattern, p.flags || 'gi');
                if (regex.test(text)) {
                    matched.push(p.label || p.pattern);
                }
            } catch { /* skip invalid regex */ }
        }

        if (matched.length > 0) {
            return { triggered: true, details: `Custom patterns matched: ${matched.join(', ')}` };
        }
        return { triggered: false, details: 'No custom patterns matched' };
    }

    /**
     * Output Format: Validate response structure (JSON required, max length, etc.)
     * Config: { requireJson: boolean, maxLength: number }
     */
    _evaluateOutputFormat(config, text) {
        if (config.requireJson) {
            try {
                JSON.parse(text);
            } catch {
                return { triggered: true, details: 'Output is not valid JSON' };
            }
        }

        if (config.maxLength && text.length > config.maxLength) {
            return { triggered: true, details: `Output length ${text.length} exceeds max ${config.maxLength}` };
        }

        return { triggered: false, details: 'Output format valid' };
    }

    // ─── Test Runner ────────────────────────────

    /**
     * Run guardrail tests against a profile.
     * testCases: [{ input, expectedVerdict: 'pass'|'block', description, direction: 'input'|'output' }]
     */
    async runGuardrailTests(profileId, testCases, agentId = null, runBy = null) {
        // Create a test run record
        const runResult = await db.query(
            `INSERT INTO guardrail_test_runs (profile_id, agent_id, total_tests, run_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [profileId, agentId, testCases.length, runBy]
        );
        const run = runResult.rows[0];

        // Get profile rules
        const rulesResult = await db.query(
            'SELECT * FROM guardrail_rules WHERE profile_id = $1 AND is_enabled = true ORDER BY sort_order ASC',
            [profileId]
        );
        const rules = rulesResult.rows;

        // Get profile mode
        const profileResult = await db.query('SELECT mode FROM guardrail_profiles WHERE id = $1', [profileId]);
        const profileMode = profileResult.rows[0]?.mode || 'block';

        const results = [];
        let passed = 0;
        let failed = 0;

        for (const testCase of testCases) {
            const direction = testCase.direction || 'input';
            const text = typeof testCase.input === 'string' ? testCase.input : JSON.stringify(testCase.input);

            // Run all matching rules
            const ruleResults = [];
            let anyBlocked = false;

            for (const rule of rules) {
                if (rule.scope !== direction && rule.scope !== 'both') continue;

                const evalResult = this._evaluateRule(rule, text);
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    ruleType: rule.rule_type,
                    severity: rule.severity,
                    triggered: evalResult.triggered,
                    details: evalResult.details,
                });

                if (evalResult.triggered && profileMode === 'block' &&
                    (rule.severity === 'critical' || rule.severity === 'high')) {
                    anyBlocked = true;
                }
            }

            // Determine actual verdict
            const actualVerdict = anyBlocked ? 'block' : 'pass';
            const expectedVerdict = testCase.expectedVerdict || 'pass';
            const testPassed = actualVerdict === expectedVerdict;

            if (testPassed) passed++;
            else failed++;

            results.push({
                description: testCase.description || '',
                input: text.substring(0, 500), // Truncate for storage
                direction,
                expectedVerdict,
                actualVerdict,
                passed: testPassed,
                ruleResults,
                violationCount: ruleResults.filter(r => r.triggered).length,
            });
        }

        // Update the run record
        await db.query(
            `UPDATE guardrail_test_runs
             SET status = 'completed', passed_tests = $1, failed_tests = $2,
                 results = $3, completed_at = NOW()
             WHERE id = $4`,
            [passed, failed, JSON.stringify(results), run.id]
        );

        logger.info(`Guardrail test run completed: ${passed}/${testCases.length} passed (profile: ${profileId})`);

        return {
            id: run.id,
            profileId,
            agentId,
            status: 'completed',
            totalTests: testCases.length,
            passedTests: passed,
            failedTests: failed,
            passRate: testCases.length > 0 ? ((passed / testCases.length) * 100).toFixed(1) : '0.0',
            results,
        };
    }

    // ─── Test Run History ───────────────────────

    async getTestRuns(profileId = null, limit = 20) {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (profileId) {
            conditions.push(`gtr.profile_id = $${idx++}`);
            params.push(profileId);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit);

        const result = await db.query(`
            SELECT gtr.*, gp.name AS profile_name, a.name AS agent_name, a.slug AS agent_slug
            FROM guardrail_test_runs gtr
            JOIN guardrail_profiles gp ON gp.id = gtr.profile_id
            LEFT JOIN agents a ON a.id = gtr.agent_id
            ${where}
            ORDER BY gtr.started_at DESC
            LIMIT $${idx}
        `, params);
        return result.rows;
    }

    async getTestRun(runId) {
        const result = await db.query(`
            SELECT gtr.*, gp.name AS profile_name, a.name AS agent_name, a.slug AS agent_slug
            FROM guardrail_test_runs gtr
            JOIN guardrail_profiles gp ON gp.id = gtr.profile_id
            LEFT JOIN agents a ON a.id = gtr.agent_id
            WHERE gtr.id = $1
        `, [runId]);
        if (result.rows.length === 0) throw new Error('Test run not found');
        return result.rows[0];
    }

    // ─── Dashboard Stats ────────────────────────

    async getStats() {
        const result = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM guardrail_profiles) AS total_profiles,
                (SELECT COUNT(*) FROM guardrail_profiles WHERE is_active = true) AS active_profiles,
                (SELECT COUNT(*) FROM guardrail_rules) AS total_rules,
                (SELECT COUNT(*) FROM guardrail_rules WHERE is_enabled = true) AS active_rules,
                (SELECT COUNT(DISTINCT agent_id) FROM agent_guardrails) AS agents_with_guardrails,
                (SELECT COUNT(*) FROM guardrail_test_runs) AS total_test_runs,
                (SELECT COUNT(*) FROM guardrail_test_runs WHERE status = 'completed') AS completed_test_runs
        `);
        return result.rows[0];
    }

    // ─── Helpers ────────────────────────────────

    /**
     * Extract text content from various payload formats (OpenAI, Anthropic, plain).
     */
    _extractText(payload) {
        if (!payload) return '';
        if (typeof payload === 'string') return payload;

        // Plain prompt
        if (payload.prompt) return payload.prompt;
        if (payload.input) return typeof payload.input === 'string' ? payload.input : JSON.stringify(payload.input);

        // OpenAI format
        if (payload.messages && Array.isArray(payload.messages)) {
            return payload.messages
                .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
                .join('\n');
        }

        // Anthropic format
        if (payload.content && Array.isArray(payload.content)) {
            return payload.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
        }

        // Fallback: stringify the whole payload
        return JSON.stringify(payload);
    }

    _isUUID(str) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    }
}

module.exports = new GuardrailsService();
