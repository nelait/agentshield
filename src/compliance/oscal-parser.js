/**
 * OSCAL (Open Security Controls Assessment Language) Parser
 * 
 * Handles parsing NIST OSCAL JSON catalogs into AI Sure compliance rules
 * and generating OSCAL Assessment Results from compliance check outputs.
 * 
 * OSCAL spec: https://pages.nist.gov/OSCAL/
 * 
 * Supported OSCAL models:
 *   - Catalog (input): control definitions grouped by category
 *   - Assessment Results (output): machine-readable compliance findings
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

class OscalParser {

    // ============================================
    // CATALOG PARSING (Import)
    // ============================================

    /**
     * Validate an OSCAL JSON structure
     * Returns { valid: boolean, errors: string[], warnings: string[] }
     */
    validate(oscalJson) {
        const errors = [];
        const warnings = [];

        if (!oscalJson) {
            return { valid: false, errors: ['Empty or null input'], warnings: [] };
        }

        // Accept both wrapped and unwrapped catalog formats
        const catalog = oscalJson.catalog || oscalJson;

        if (!catalog.uuid && !catalog['catalog-uuid']) {
            errors.push('Missing catalog.uuid — required by OSCAL spec');
        }

        if (!catalog.metadata) {
            errors.push('Missing catalog.metadata');
        } else {
            if (!catalog.metadata.title) errors.push('Missing catalog.metadata.title');
            if (!catalog.metadata.version) warnings.push('Missing catalog.metadata.version (recommended)');
        }

        if (!catalog.groups && !catalog.controls) {
            errors.push('Catalog must have at least one "groups" array or "controls" array');
        }

        // Check for controls within groups
        if (catalog.groups) {
            const emptyGroups = catalog.groups.filter(g => 
                (!g.controls || g.controls.length === 0) && (!g.groups || g.groups.length === 0)
            );
            if (emptyGroups.length > 0) {
                warnings.push(`${emptyGroups.length} group(s) have no controls`);
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Parse an OSCAL catalog JSON into a normalized structure
     * Returns { catalogId, title, version, groups: [...], controls: [...] }
     */
    parseCatalog(oscalJson) {
        const catalog = oscalJson.catalog || oscalJson;
        const catalogId = catalog.uuid || catalog['catalog-uuid'] || uuidv4();
        const metadata = catalog.metadata || {};

        const result = {
            catalogId,
            title: metadata.title || 'Untitled Catalog',
            version: metadata.version || metadata['oscal-version'] || '1.0.0',
            lastModified: metadata['last-modified'] || new Date().toISOString(),
            groups: [],
            controls: [],
        };

        // Parse top-level groups
        if (catalog.groups) {
            for (const group of catalog.groups) {
                this._parseGroup(group, result, null);
            }
        }

        // Parse top-level controls (some catalogs put controls at root level)
        if (catalog.controls) {
            for (const control of catalog.controls) {
                result.controls.push(this._parseControl(control, null));
            }
        }

        logger.info(`OSCAL catalog parsed: "${result.title}" — ${result.groups.length} groups, ${result.controls.length} controls`);
        return result;
    }

    /**
     * Convert a parsed OSCAL control into a compliance_rules row format
     */
    controlToRule(control, framework, catalogId) {
        return {
            framework: framework || 'custom',
            rule_id: control.id,
            name: control.title,
            description: control.statement || control.title,
            category: control.groupTitle || control.groupId || 'general',
            severity: this._extractSeverity(control),
            is_builtin: false,
            is_enabled: true,
            oscal_catalog_id: catalogId,
            oscal_control_id: control.id,
            oscal_statement: control.statement || null,
            oscal_guidance: control.guidance || null,
            evaluation_config: JSON.stringify({
                source: 'oscal',
                controlId: control.id,
                // Use keywords from the statement for basic evaluation
                keywords: this._extractKeywords(control.statement || control.title),
            }),
        };
    }

    // ============================================
    // ASSESSMENT RESULTS (Export)
    // ============================================

    /**
     * Generate an OSCAL Assessment Results document from a compliance check
     * 
     * @param {Object} checkResult — from ComplianceService.runComplianceCheck()
     * @param {Object} catalogMeta — { title, version, catalogId }
     * @param {Object} systemInfo — { systemName, systemId }
     */
    generateAssessmentResult(checkResult, catalogMeta = {}, systemInfo = {}) {
        const now = new Date().toISOString();
        const findings = [];
        const observations = [];

        for (const rule of (checkResult.results || [])) {
            const obsUuid = uuidv4();
            const findingUuid = uuidv4();

            // Create observation
            observations.push({
                uuid: obsUuid,
                title: `${rule.ruleName} — Observation`,
                description: rule.details || 'No details available',
                methods: ['TEST'],
                collected: checkResult.completedAt || now,
                ...(rule.ruleId && { 'relevant-evidence': [{ description: `Rule ID: ${rule.ruleId}` }] }),
            });

            // Create finding
            findings.push({
                uuid: findingUuid,
                title: rule.ruleName || rule.ruleId,
                description: rule.description || rule.ruleName,
                target: {
                    type: 'objective-id',
                    'target-id': rule.ruleId || rule.ruleName,
                    status: { state: rule.passed ? 'satisfied' : 'not-satisfied' },
                },
                ...(rule.severity && {
                    'characterizations': [{
                        facets: [{ name: 'severity', value: rule.severity, system: 'aisure' }],
                    }],
                }),
                'related-observations': [{ 'observation-uuid': obsUuid }],
            });
        }

        return {
            'assessment-results': {
                uuid: uuidv4(),
                metadata: {
                    title: `AI Sure Compliance Assessment — ${checkResult.framework?.toUpperCase() || 'Unknown'} ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}`,
                    version: '1.0.0',
                    'oscal-version': '1.1.2',
                    'last-modified': now,
                    roles: [{ id: 'assessor', title: 'AI Sure Automated Assessor' }],
                    parties: [{
                        uuid: uuidv4(),
                        type: 'tool',
                        name: 'AI Sure Governance Firewall',
                    }],
                    ...(catalogMeta.title && {
                        props: [
                            { name: 'catalog-title', value: catalogMeta.title },
                            { name: 'catalog-version', value: catalogMeta.version || '1.0.0' },
                        ],
                    }),
                },
                'import-ap': {
                    href: '#',
                    remarks: 'Assessment plan generated automatically by AI Sure',
                },
                results: [{
                    uuid: uuidv4(),
                    title: `${checkResult.framework?.toUpperCase() || ''} Check — ${systemInfo.systemName || 'AI Agent'}`,
                    description: `Automated compliance check run by AI Sure`,
                    start: checkResult.startedAt || now,
                    end: checkResult.completedAt || now,
                    props: [
                        { name: 'status', value: checkResult.status || 'unknown' },
                        { name: 'total-rules', value: String(checkResult.totalRules || 0) },
                        { name: 'passed-rules', value: String(checkResult.passedRules || 0) },
                        { name: 'failed-rules', value: String(checkResult.failedRules || 0) },
                    ],
                    findings,
                    observations,
                }],
            },
        };
    }

    // ============================================
    // Private helpers
    // ============================================

    /**
     * Recursively parse a group and its controls
     */
    _parseGroup(group, result, parentGroupId) {
        const groupInfo = {
            id: group.id || uuidv4(),
            title: group.title || 'Untitled Group',
            controlCount: 0,
            parentGroupId,
        };

        // Parse controls in this group
        if (group.controls) {
            for (const control of group.controls) {
                const parsed = this._parseControl(control, groupInfo.id, groupInfo.title);
                result.controls.push(parsed);
                groupInfo.controlCount++;

                // Parse sub-controls (enhancements)
                if (control.controls) {
                    for (const sub of control.controls) {
                        result.controls.push(this._parseControl(sub, groupInfo.id, groupInfo.title, control.id));
                        groupInfo.controlCount++;
                    }
                }
            }
        }

        // Parse nested sub-groups
        if (group.groups) {
            for (const subGroup of group.groups) {
                this._parseGroup(subGroup, result, groupInfo.id);
            }
        }

        result.groups.push(groupInfo);
    }

    /**
     * Parse a single OSCAL control into a normalized format
     */
    _parseControl(control, groupId, groupTitle, parentControlId) {
        return {
            id: control.id || uuidv4(),
            title: control.title || 'Untitled Control',
            groupId: groupId || null,
            groupTitle: groupTitle || null,
            parentControlId: parentControlId || null,
            statement: this._extractPart(control, 'statement'),
            guidance: this._extractPart(control, 'guidance'),
            severity: this._extractProp(control, 'severity') || 'medium',
            category: this._extractProp(control, 'category') || groupId || 'general',
            props: (control.props || []).reduce((acc, p) => {
                acc[p.name] = p.value;
                return acc;
            }, {}),
        };
    }

    /**
     * Extract a named part's prose from a control
     */
    _extractPart(control, partName) {
        if (!control.parts) return null;
        const part = control.parts.find(p => p.name === partName);
        if (!part) return null;

        // Part may have prose directly or nested parts
        if (part.prose) return part.prose;
        if (part.parts) {
            return part.parts.map(p => p.prose || '').filter(Boolean).join('\n');
        }
        return null;
    }

    /**
     * Extract a named prop value from a control
     */
    _extractProp(control, propName) {
        if (!control.props) return null;
        const prop = control.props.find(p => p.name === propName);
        return prop ? prop.value : null;
    }

    /**
     * Determine severity from control props or content
     */
    _extractSeverity(control) {
        // Check explicit severity prop
        const explicitSeverity = control.severity || control.props?.severity;
        if (explicitSeverity) {
            const normalized = explicitSeverity.toLowerCase();
            if (['critical', 'high', 'medium', 'low'].includes(normalized)) return normalized;
        }

        // Infer from keywords in title/statement
        const text = `${control.title || ''} ${control.statement || ''}`.toLowerCase();
        if (text.includes('must') || text.includes('critical') || text.includes('shall not')) return 'critical';
        if (text.includes('should') || text.includes('important')) return 'high';
        if (text.includes('may') || text.includes('consider')) return 'low';
        return 'medium';
    }

    /**
     * Extract meaningful keywords from statement text for basic evaluation matching
     */
    _extractKeywords(text) {
        if (!text) return [];
        // Extract words > 4 chars, deduplicate, limit to 20
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 4)
            .filter(w => !['shall', 'should', 'which', 'their', 'these', 'those', 'would', 'could', 'about', 'being'].includes(w));
        return [...new Set(words)].slice(0, 20);
    }
}

module.exports = new OscalParser();
