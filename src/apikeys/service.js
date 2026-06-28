const crypto = require('crypto');
const db = require('../db');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

class ApiKeyService {
    /**
     * Create a new API key. Returns the raw key only once.
     */
    async createKey({ name, ownerId, role = 'viewer', scopes = ['policy:check'], expiresAt = null }) {
        // Generate a random 32-byte key with prefix
        const rawKey = `ask_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const keyPrefix = rawKey.substring(0, 12);

        const result = await db.query(
            `INSERT INTO api_keys (name, key_hash, key_prefix, owner_id, role, scopes, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, key_prefix, role, scopes, is_active, created_at, expires_at`,
            [name, keyHash, keyPrefix, ownerId || null, role, JSON.stringify(scopes), expiresAt]
        );

        logger.info(`API key created: ${name} (${keyPrefix}...)`);

        return {
            ...result.rows[0],
            key: rawKey, // Only returned at creation time
        };
    }

    /**
     * List all API keys (never returns the raw key)
     */
    async listKeys() {
        const result = await db.query(
            `SELECT id, name, key_prefix, role, scopes, is_active, last_used_at, created_at, expires_at
             FROM api_keys
             ORDER BY created_at DESC`
        );
        return result.rows;
    }

    /**
     * Validate an API key and return the associated identity.
     * Updates last_used_at on successful validation.
     */
    async validateKey(rawKey) {
        if (!rawKey || !rawKey.startsWith('ask_')) {
            return null;
        }

        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const result = await db.query(
            `SELECT id, name, key_prefix, owner_id, role, scopes, is_active, expires_at
             FROM api_keys
             WHERE key_hash = $1`,
            [keyHash]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const apiKey = result.rows[0];

        // Check if key is active
        if (!apiKey.is_active) {
            return null;
        }

        // Check expiry
        if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
            return null;
        }

        // Update last_used_at (fire-and-forget)
        db.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [apiKey.id])
            .catch(err => logger.error('Failed to update API key last_used_at:', err));

        return {
            id: apiKey.owner_id || apiKey.id,
            role: apiKey.role,
            email: `apikey-${apiKey.key_prefix}@agentshield.local`,
            department: 'api',
            apiKeyId: apiKey.id,
            apiKeyName: apiKey.name,
            scopes: apiKey.scopes,
        };
    }

    /**
     * Check if a validated API key identity has a specific scope
     */
    hasScope(identity, scope) {
        if (!identity || !identity.scopes) return false;
        return identity.scopes.includes(scope) || identity.scopes.includes('*');
    }

    /**
     * Revoke (delete) an API key
     */
    async revokeKey(id) {
        const result = await db.query('DELETE FROM api_keys WHERE id = $1 RETURNING name, key_prefix', [id]);
        if (result.rows.length === 0) {
            throw new AppError('API key not found', 404);
        }
        logger.info(`API key revoked: ${result.rows[0].name} (${result.rows[0].key_prefix}...)`);
        return { deleted: true };
    }
}

module.exports = new ApiKeyService();
