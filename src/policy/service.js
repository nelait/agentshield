const db = require('../db');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

class PolicyService {
    /**
     * Evaluate a request against all active policies
     * Returns { allowed: boolean, reason: string, matchedPolicy: object|null }
     */
    async evaluate(context) {
        const { user, agent, workflow, action } = context;

        // Get all active access_control policies, ordered by priority
        const { rows: policies } = await db.query(
            `SELECT * FROM policies
       WHERE is_active = true AND policy_type = 'access_control'
       ORDER BY priority ASC`
        );

        if (policies.length === 0) {
            // No policies = allow by default
            return { allowed: true, reason: 'No policies defined — default allow', matchedPolicy: null };
        }

        for (const policy of policies) {
            const result = this._evaluatePolicy(policy, context);
            if (result.matched) {
                return {
                    allowed: result.effect === 'allow',
                    reason: result.reason,
                    matchedPolicy: { id: policy.id, name: policy.name },
                };
            }
        }

        // No policy matched — deny by default
        return { allowed: false, reason: 'No matching policy — default deny', matchedPolicy: null };
    }

    /**
     * Evaluate a single policy against a context
     */
    _evaluatePolicy(policy, context) {
        const rules = policy.rules_json;

        if (!rules || !rules.effect) {
            return { matched: false };
        }

        // Check subject conditions (filter out empty/placeholder conditions)
        const validSubjects = (rules.subjects || []).filter(c => c.field && c.field.trim());
        if (validSubjects.length > 0) {
            const subjectMatch = validSubjects.every(cond =>
                this._evaluateCondition(cond, context.user)
            );
            if (!subjectMatch) return { matched: false };
        }

        // Check resource conditions (agent/workflow) — filter out empty conditions
        const validResources = (rules.resources || []).filter(c => c.field && c.field.trim());
        if (validResources.length > 0) {
            const target = context.workflow || context.agent || {};
            const resourceMatch = validResources.some(cond =>
                this._evaluateCondition(cond, target)
            );
            if (!resourceMatch) return { matched: false };
        }

        // Check additional conditions (time, MFA, etc.) — filter out empty conditions
        const validConditions = (rules.conditions || []).filter(c => c.field && c.field.trim());
        if (validConditions.length > 0) {
            const conditionsMatch = validConditions.every(cond =>
                this._evaluateCondition(cond, context)
            );
            if (!conditionsMatch) return { matched: false };
        }

        return {
            matched: true,
            effect: rules.effect,
            reason: `Policy "${policy.name}" (${rules.effect})`,
        };
    }

    /**
     * Evaluate a single condition
     */
    _evaluateCondition(condition, data) {
        const { field, op, value } = condition;

        // Skip empty/placeholder conditions — treat as auto-pass
        if (!field || !field.trim()) return true;

        const actual = this._getNestedValue(data, field);

        switch (op) {
            case 'eq': return actual === value;
            case 'neq': return actual !== value;
            case 'in': return Array.isArray(value) && value.includes(actual);
            case 'not_in': return Array.isArray(value) && !value.includes(actual);
            case 'contains': return typeof actual === 'string' && actual.includes(value);
            case 'starts_with': return typeof actual === 'string' && actual.startsWith(value);
            case 'gt': return actual > value;
            case 'gte': return actual >= value;
            case 'lt': return actual < value;
            case 'lte': return actual <= value;
            case 'exists': return actual !== undefined && actual !== null;
            case 'between':
                if (field === 'time' || field === 'hour') {
                    const hour = new Date().getHours();
                    return hour >= value[0] && hour < value[1];
                }
                return actual >= value[0] && actual <= value[1];
            default:
                logger.warn(`Unknown condition operator: ${op}`);
                return false;
        }
    }

    /**
     * Get nested value from an object using dot notation
     */
    _getNestedValue(obj, path) {
        return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    }

    // ============================================
    // CRUD operations
    // ============================================

    async createPolicy(data, createdBy = null) {
        const result = await db.query(
            `INSERT INTO policies (name, description, policy_type, rules_json, applies_to, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            [
                data.name, data.description || null, data.policyType,
                JSON.stringify(data.rulesJson), JSON.stringify(data.appliesTo || {}),
                data.priority || 100, createdBy,
            ]
        );
        logger.info(`Policy created: ${data.name}`);
        return result.rows[0];
    }

    async listPolicies(filters = {}) {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (filters.policyType) {
            conditions.push(`policy_type = $${idx++}`);
            params.push(filters.policyType);
        }
        if (filters.isActive !== undefined) {
            conditions.push(`is_active = $${idx++}`);
            params.push(filters.isActive);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await db.query(
            `SELECT * FROM policies ${where} ORDER BY priority ASC, created_at DESC`,
            params
        );
        return result.rows;
    }

    async getPolicy(id) {
        const result = await db.query('SELECT * FROM policies WHERE id = $1', [id]);
        if (result.rows.length === 0) throw new AppError('Policy not found', 404);
        return result.rows[0];
    }

    async updatePolicy(id, updates) {
        const policy = await this.getPolicy(id);
        const fields = [];
        const params = [];
        let idx = 1;

        if (updates.name) { fields.push(`name = $${idx++}`); params.push(updates.name); }
        if (updates.description !== undefined) { fields.push(`description = $${idx++}`); params.push(updates.description); }
        if (updates.rulesJson) { fields.push(`rules_json = $${idx++}`); params.push(JSON.stringify(updates.rulesJson)); }
        if (updates.appliesTo) { fields.push(`applies_to = $${idx++}`); params.push(JSON.stringify(updates.appliesTo)); }
        if (updates.priority !== undefined) { fields.push(`priority = $${idx++}`); params.push(updates.priority); }
        if (updates.isActive !== undefined) { fields.push(`is_active = $${idx++}`); params.push(updates.isActive); }

        if (fields.length === 0) return policy;

        fields.push('updated_at = NOW()');
        params.push(id);

        const result = await db.query(
            `UPDATE policies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );
        return result.rows[0];
    }

    async deletePolicy(id) {
        await db.query('DELETE FROM policies WHERE id = $1', [id]);
        logger.info(`Policy deleted: ${id}`);
    }
}

module.exports = new PolicyService();
