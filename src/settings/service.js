const db = require('../db');
const logger = require('../config/logger');

class SettingsService {
    constructor() {
        // Module feature-flag cache (refreshes every 30s)
        this._moduleCache = null;
        this._moduleCacheExpiry = 0;
    }

    // ============================================
    // MODULE TOGGLE SYSTEM
    // ============================================

    /**
     * Check if a module is enabled. Defaults to true (enabled) if no setting exists.
     * Uses a 30-second in-memory cache to avoid DB queries on every gateway request.
     */
    async getModuleStatus(moduleKey) {
        if (!this._moduleCache || Date.now() > this._moduleCacheExpiry) {
            await this._refreshModuleCache();
        }
        const mod = this._moduleCache[moduleKey];
        return mod?.enabled !== false; // Default: enabled
    }

    /**
     * Get all module statuses for the dashboard.
     */
    async getAllModuleStatuses() {
        if (!this._moduleCache || Date.now() > this._moduleCacheExpiry) {
            await this._refreshModuleCache();
        }
        return { ...this._moduleCache };
    }

    /**
     * Invalidate the module cache (called after settings updates).
     */
    invalidateModuleCache() {
        this._moduleCache = null;
        this._moduleCacheExpiry = 0;
        logger.info('Module feature-flag cache invalidated');
    }

    async _refreshModuleCache() {
        try {
            const rows = await this.getSettings('modules');
            this._moduleCache = {};
            rows.forEach(r => {
                const val = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
                this._moduleCache[r.key] = val;
            });
            this._moduleCacheExpiry = Date.now() + 30000; // 30s TTL
        } catch (err) {
            logger.error('Failed to refresh module cache:', err);
            // Fail-open: default all modules to enabled
            this._moduleCache = {};
            this._moduleCacheExpiry = Date.now() + 5000; // Retry sooner on error
        }
    }

    // ============================================
    // SETTINGS CRUD
    // ============================================

    async getSettings(category) {
        const { rows } = await db.query(
            'SELECT * FROM settings WHERE category = $1 ORDER BY key',
            [category]
        );
        return rows;
    }

    async getSetting(category, key) {
        const { rows } = await db.query(
            'SELECT * FROM settings WHERE category = $1 AND key = $2',
            [category, key]
        );
        return rows[0] || null;
    }

    async upsertSetting({ category, key, value, description }) {
        const { rows } = await db.query(
            `INSERT INTO settings (category, key, value, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (category, key) DO UPDATE SET
                value = EXCLUDED.value,
                description = EXCLUDED.description,
                updated_at = NOW()
             RETURNING *`,
            [category, key, JSON.stringify(value), description || null]
        );
        return rows[0];
    }

    async deleteSetting(id) {
        await db.query('DELETE FROM settings WHERE id = $1', [id]);
    }

    // ============================================
    // COMPLIANCE RULES CRUD
    // ============================================

    async getComplianceRules(framework) {
        const { rows } = await db.query(
            'SELECT * FROM compliance_rules WHERE framework = $1 ORDER BY rule_id',
            [framework]
        );
        return rows;
    }

    async getEnabledRules(framework) {
        const { rows } = await db.query(
            'SELECT * FROM compliance_rules WHERE framework = $1 AND is_enabled = true ORDER BY rule_id',
            [framework]
        );
        return rows;
    }

    async upsertComplianceRule({ id, framework, ruleId, name, description, category, severity, isEnabled, evaluationConfig }) {
        if (id) {
            // Update existing
            const { rows } = await db.query(
                `UPDATE compliance_rules SET
                    name = COALESCE($1, name),
                    description = COALESCE($2, description),
                    category = COALESCE($3, category),
                    severity = COALESCE($4, severity),
                    is_enabled = COALESCE($5, is_enabled),
                    evaluation_config = COALESCE($6, evaluation_config),
                    updated_at = NOW()
                 WHERE id = $7 RETURNING *`,
                [name, description, category, severity, isEnabled, evaluationConfig ? JSON.stringify(evaluationConfig) : null, id]
            );
            return rows[0];
        } else {
            // Create new
            const newRuleId = ruleId || `${framework}-custom-${Date.now()}`;
            const { rows } = await db.query(
                `INSERT INTO compliance_rules (framework, rule_id, name, description, category, severity, is_enabled, is_builtin, evaluation_config)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
                 RETURNING *`,
                [framework, newRuleId, name, description || '', category || 'custom', severity || 'medium', isEnabled !== false, evaluationConfig ? JSON.stringify(evaluationConfig) : '{}']
            );
            return rows[0];
        }
    }

    async toggleRule(id, isEnabled) {
        const { rows } = await db.query(
            'UPDATE compliance_rules SET is_enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [isEnabled, id]
        );
        return rows[0];
    }

    async deleteRule(id) {
        // Only allow deleting non-builtin rules
        const { rows } = await db.query('SELECT is_builtin FROM compliance_rules WHERE id = $1', [id]);
        if (rows.length === 0) throw new Error('Rule not found');
        if (rows[0].is_builtin) throw new Error('Cannot delete built-in rules. Disable them instead.');
        await db.query('DELETE FROM compliance_rules WHERE id = $1', [id]);
    }

    // ============================================
    // COMPLIANCE CHECK HISTORY (global)
    // ============================================

    async getAllChecksHistory(limit = 50) {
        const { rows } = await db.query(
            `SELECT cc.*, cfg.name as config_name, cfg.framework
             FROM compliance_checks cc
             JOIN compliance_configs cfg ON cc.config_id = cfg.id
             ORDER BY cc.started_at DESC
             LIMIT $1`,
            [limit]
        );
        return rows;
    }
}

module.exports = new SettingsService();
