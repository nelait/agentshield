const yaml = require('js-yaml');
const logger = require('../config/logger');

// ============================================
// YAML Guardrail Parser & Generator
// Implements the AI Sure YAML guardrail format
// for import/export of guardrail profiles.
// ============================================

// Valid values for schema validation
const VALID_RULE_TYPES = [
    'content_filter', 'pii_shield', 'prompt_injection',
    'topic_boundary', 'token_limit', 'custom_regex',
    'output_format', 'llm_judge',
];
const VALID_SCOPES = ['input', 'output', 'both'];
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const VALID_MODES = ['block', 'log_only'];
const VALID_ACTIONS = ['block', 'log', 'redact'];

// Map YAML action → DB mode for profiles
const ACTION_TO_MODE = { block: 'block', log: 'log_only', redact: 'block' };

// Friendly type aliases → DB rule_type
const TYPE_ALIASES = {
    'content-filter': 'content_filter',
    'content_filter': 'content_filter',
    'pii-shield': 'pii_shield',
    'pii_shield': 'pii_shield',
    'pii': 'pii_shield',
    'prompt-injection': 'prompt_injection',
    'prompt_injection': 'prompt_injection',
    'topic-boundary': 'topic_boundary',
    'topic_boundary': 'topic_boundary',
    'token-limit': 'token_limit',
    'token_limit': 'token_limit',
    'custom-regex': 'custom_regex',
    'custom_regex': 'custom_regex',
    'regex': 'custom_regex',
    'output-format': 'output_format',
    'output_format': 'output_format',
    'llm-judge': 'llm_judge',
    'llm_judge': 'llm_judge',
};

class YamlGuardrailParser {

    /**
     * Validate a YAML string against the guardrail schema.
     * Returns { valid: boolean, errors: string[], parsed: object|null }
     */
    validate(yamlString) {
        const errors = [];

        // 1. Parse YAML
        let doc;
        try {
            doc = yaml.load(yamlString);
        } catch (e) {
            return { valid: false, errors: [`YAML parse error: ${e.message}`], parsed: null };
        }

        if (!doc || typeof doc !== 'object') {
            return { valid: false, errors: ['YAML must contain a document object'], parsed: null };
        }

        // 2. Check top-level key
        const guardrail = doc.guardrail;
        if (!guardrail) {
            return { valid: false, errors: ['Missing required top-level key: "guardrail"'], parsed: null };
        }

        // 3. Required fields
        if (!guardrail.name || typeof guardrail.name !== 'string') {
            errors.push('guardrail.name is required and must be a string');
        }

        // 4. Optional field validation
        if (guardrail.mode && !VALID_MODES.includes(guardrail.mode)) {
            errors.push(`guardrail.mode must be one of: ${VALID_MODES.join(', ')} (got "${guardrail.mode}")`);
        }

        if (guardrail.scope) {
            const scopes = Array.isArray(guardrail.scope) ? guardrail.scope : [guardrail.scope];
            for (const s of scopes) {
                if (!VALID_SCOPES.includes(s)) {
                    errors.push(`guardrail.scope contains invalid value: "${s}" (valid: ${VALID_SCOPES.join(', ')})`);
                }
            }
        }

        // 5. Rules validation
        if (!guardrail.rules || !Array.isArray(guardrail.rules) || guardrail.rules.length === 0) {
            errors.push('guardrail.rules is required and must be a non-empty array');
        } else {
            guardrail.rules.forEach((rule, idx) => {
                const prefix = `rules[${idx}]`;

                if (!rule.name && !rule.id) {
                    errors.push(`${prefix}: must have at least a "name" or "id"`);
                }

                // Validate type
                if (rule.type) {
                    const resolvedType = TYPE_ALIASES[rule.type];
                    if (!resolvedType) {
                        errors.push(`${prefix}: invalid type "${rule.type}" (valid: ${Object.keys(TYPE_ALIASES).join(', ')})`);
                    }
                }

                // Validate severity
                if (rule.severity && !VALID_SEVERITIES.includes(rule.severity)) {
                    errors.push(`${prefix}: invalid severity "${rule.severity}" (valid: ${VALID_SEVERITIES.join(', ')})`);
                }

                // Validate scope
                if (rule.scope && !VALID_SCOPES.includes(rule.scope)) {
                    errors.push(`${prefix}: invalid scope "${rule.scope}" (valid: ${VALID_SCOPES.join(', ')})`);
                }

                // Validate action
                if (rule.action && !VALID_ACTIONS.includes(rule.action)) {
                    errors.push(`${prefix}: invalid action "${rule.action}" (valid: ${VALID_ACTIONS.join(', ')})`);
                }

                // Type-specific config validation
                if (rule.type) {
                    const resolvedType = TYPE_ALIASES[rule.type];
                    if (resolvedType === 'content_filter' && rule.pattern && !rule.keywords) {
                        // content_filter with pattern → auto-convert to custom_regex
                    }
                    if (resolvedType === 'token_limit' && rule.max_tokens && typeof rule.max_tokens !== 'number') {
                        errors.push(`${prefix}: max_tokens must be a number`);
                    }
                }
            });
        }

        // 6. Exceptions validation (optional)
        if (guardrail.exceptions && Array.isArray(guardrail.exceptions)) {
            guardrail.exceptions.forEach((exc, idx) => {
                if (!exc.agent) {
                    errors.push(`exceptions[${idx}]: must have an "agent" field`);
                }
            });
        }

        return {
            valid: errors.length === 0,
            errors,
            parsed: errors.length === 0 ? doc : null,
        };
    }

    /**
     * Parse a YAML guardrail string into a normalized object for import.
     * Returns { profile, rules, exceptions }
     */
    parseGuardrail(yamlString) {
        const validation = this.validate(yamlString);
        if (!validation.valid) {
            const err = new Error(`Invalid YAML guardrail: ${validation.errors.join('; ')}`);
            err.statusCode = 400;
            err.isOperational = true;
            err.validationErrors = validation.errors;
            throw err;
        }

        const doc = yaml.load(yamlString);
        const g = doc.guardrail;

        // Build profile object
        const defaultScope = Array.isArray(g.scope) ? g.scope : (g.scope ? [g.scope] : ['both']);
        const profile = {
            name: g.name,
            description: g.description || null,
            mode: g.mode || 'block',
            version: g.version || '1.0',
        };

        // Build rules array
        const rules = (g.rules || []).map((r, idx) => this.yamlRuleToDbRule(r, idx, defaultScope));

        // Build exceptions
        const exceptions = (g.exceptions || []).map(exc => ({
            agent: exc.agent,
            skipRules: exc.skip_rules || [],
            reason: exc.reason || null,
        }));

        return { profile, rules, exceptions };
    }

    /**
     * Convert a YAML rule → DB-compatible rule object.
     */
    yamlRuleToDbRule(yamlRule, idx = 0, defaultScope = ['both']) {
        const ruleType = TYPE_ALIASES[yamlRule.type] || this._inferType(yamlRule);
        const scope = yamlRule.scope || (defaultScope.length === 1 ? defaultScope[0] : 'both');

        // Build config object based on rule type
        const config = this._buildConfig(ruleType, yamlRule);

        return {
            name: yamlRule.name || yamlRule.id || `Rule ${idx + 1}`,
            description: yamlRule.description || yamlRule.message || null,
            rule_type: ruleType,
            scope,
            severity: yamlRule.severity || 'high',
            sort_order: idx,
            is_enabled: yamlRule.enabled !== false,
            config,
            _yamlId: yamlRule.id || null, // Preserve YAML ID for exceptions mapping
        };
    }

    /**
     * Convert a DB guardrail_rule row → YAML-friendly rule object.
     */
    ruleToYamlRule(dbRule) {
        const config = typeof dbRule.config === 'string' ? JSON.parse(dbRule.config) : (dbRule.config || {});
        const yamlRule = {
            id: this._slugify(dbRule.name),
            name: dbRule.name,
            type: dbRule.rule_type.replace(/_/g, '-'),
            severity: dbRule.severity,
            scope: dbRule.scope,
        };

        if (dbRule.description) yamlRule.description = dbRule.description;
        if (!dbRule.is_enabled) yamlRule.enabled = false;

        // Flatten config into rule-level fields for readability
        this._flattenConfig(yamlRule, dbRule.rule_type, config);

        return yamlRule;
    }

    /**
     * Generate a complete YAML string from a DB profile, its rules, and assigned agents.
     */
    generateYaml(profile, rules, agents = []) {
        const guardrail = {
            name: profile.name,
            version: '1.0',
            description: profile.description || undefined,
            mode: profile.mode,
            scope: ['input', 'output'],
        };

        // Convert rules
        guardrail.rules = rules.map(r => this.ruleToYamlRule(r));

        // Add exceptions from agent assignments (metadata only)
        if (agents && agents.length > 0) {
            guardrail.agents = agents.map(a => a.slug || a.name);
        }

        const doc = { guardrail };

        // Generate YAML with header comment
        const yamlStr = yaml.dump(doc, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
            quotingType: "'",
            forceQuotes: false,
        });

        const header = [
            `# AI Sure — Guardrail Profile`,
            `# Generated: ${new Date().toISOString().split('T')[0]}`,
            `# https://agentshield-dashboard.web.app`,
            `#`,
            `# This file can be version-controlled in Git and re-imported`,
            `# into the AI Sure dashboard at any time.`,
            ``,
        ].join('\n');

        return header + yamlStr;
    }

    // ─── Private Helpers ────────────────────────

    /**
     * Infer rule_type from YAML fields when type is not explicitly specified.
     */
    _inferType(yamlRule) {
        if (yamlRule.pattern || yamlRule.patterns) return 'custom_regex';
        if (yamlRule.keywords) return 'content_filter';
        if (yamlRule.max_tokens) return 'token_limit';
        if (yamlRule.allowed_topics || yamlRule.blocked_topics) return 'topic_boundary';
        if (yamlRule.require_json || yamlRule.max_length) return 'output_format';
        return 'custom_regex'; // fallback
    }

    /**
     * Build a config JSONB object from YAML rule fields based on rule type.
     */
    _buildConfig(ruleType, yamlRule) {
        const config = {};

        switch (ruleType) {
            case 'content_filter':
                if (yamlRule.keywords) config.keywords = yamlRule.keywords;
                if (yamlRule.case_sensitive !== undefined) config.caseSensitive = yamlRule.case_sensitive;
                break;

            case 'pii_shield':
                if (yamlRule.patterns) config.patterns = yamlRule.patterns;
                if (yamlRule.custom_patterns) config.customPatterns = yamlRule.custom_patterns;
                break;

            case 'prompt_injection':
                if (yamlRule.extra_patterns) config.extraPatterns = yamlRule.extra_patterns;
                break;

            case 'topic_boundary':
                if (yamlRule.allowed_topics) config.allowedTopics = yamlRule.allowed_topics;
                if (yamlRule.blocked_topics) config.blockedTopics = yamlRule.blocked_topics;
                break;

            case 'token_limit':
                if (yamlRule.max_tokens) config.maxTokens = yamlRule.max_tokens;
                break;

            case 'custom_regex': {
                const patterns = [];
                if (yamlRule.pattern) {
                    patterns.push({
                        pattern: yamlRule.pattern,
                        flags: yamlRule.flags || 'gi',
                        label: yamlRule.name || yamlRule.id || 'Pattern',
                    });
                }
                if (yamlRule.patterns && Array.isArray(yamlRule.patterns)) {
                    for (const p of yamlRule.patterns) {
                        if (typeof p === 'string') {
                            patterns.push({ pattern: p, flags: 'gi', label: p.substring(0, 30) });
                        } else {
                            patterns.push({
                                pattern: p.pattern || p,
                                flags: p.flags || 'gi',
                                label: p.label || p.pattern?.substring(0, 30) || 'Pattern',
                            });
                        }
                    }
                }
                if (patterns.length > 0) config.patterns = patterns;
                break;
            }

            case 'output_format':
                if (yamlRule.require_json !== undefined) config.requireJson = yamlRule.require_json;
                if (yamlRule.max_length) config.maxLength = yamlRule.max_length;
                break;

            case 'llm_judge':
                if (yamlRule.prompt) config.prompt = yamlRule.prompt;
                if (yamlRule.model) config.model = yamlRule.model;
                if (yamlRule.threshold) config.threshold = yamlRule.threshold;
                break;
        }

        // Merge any explicit config object from YAML
        if (yamlRule.config && typeof yamlRule.config === 'object') {
            Object.assign(config, yamlRule.config);
        }

        return config;
    }

    /**
     * Flatten a DB config object into YAML rule-level fields for readability.
     */
    _flattenConfig(yamlRule, ruleType, config) {
        switch (ruleType) {
            case 'content_filter':
                if (config.keywords) yamlRule.keywords = config.keywords;
                if (config.caseSensitive) yamlRule.case_sensitive = config.caseSensitive;
                break;

            case 'pii_shield':
                if (config.patterns) yamlRule.detect = config.patterns;
                if (config.customPatterns) yamlRule.custom_patterns = config.customPatterns;
                break;

            case 'prompt_injection':
                if (config.extraPatterns) yamlRule.extra_patterns = config.extraPatterns;
                break;

            case 'topic_boundary':
                if (config.allowedTopics) yamlRule.allowed_topics = config.allowedTopics;
                if (config.blockedTopics) yamlRule.blocked_topics = config.blockedTopics;
                break;

            case 'token_limit':
                if (config.maxTokens) yamlRule.max_tokens = config.maxTokens;
                break;

            case 'custom_regex':
                if (config.patterns && config.patterns.length === 1) {
                    yamlRule.pattern = config.patterns[0].pattern;
                } else if (config.patterns && config.patterns.length > 1) {
                    yamlRule.patterns = config.patterns.map(p => ({
                        pattern: p.pattern,
                        label: p.label,
                        flags: p.flags,
                    }));
                }
                break;

            case 'output_format':
                if (config.requireJson) yamlRule.require_json = config.requireJson;
                if (config.maxLength) yamlRule.max_length = config.maxLength;
                break;

            case 'llm_judge':
                if (config.prompt) yamlRule.prompt = config.prompt;
                if (config.model) yamlRule.model = config.model;
                if (config.threshold) yamlRule.threshold = config.threshold;
                break;

            default:
                // For unknown types, dump config as-is
                if (Object.keys(config).length > 0) yamlRule.config = config;
        }
    }

    /**
     * Slugify a name for use as a YAML rule ID.
     */
    _slugify(str) {
        return str
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);
    }
}

module.exports = new YamlGuardrailParser();
