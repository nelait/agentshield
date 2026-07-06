const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

/**
 * UserService — Full CRUD + password management + session management
 */
class UserService {

    // ============================================
    // PASSWORD POLICY
    // ============================================
    static PASSWORD_MIN_LENGTH = 8;
    static PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[0-9]).{8,}$/;

    validatePassword(password) {
        if (!password || password.length < UserService.PASSWORD_MIN_LENGTH) {
            throw new AppError(`Password must be at least ${UserService.PASSWORD_MIN_LENGTH} characters`, 400);
        }
        if (!UserService.PASSWORD_REGEX.test(password)) {
            throw new AppError('Password must contain at least 1 uppercase letter and 1 number', 400);
        }
    }

    // ============================================
    // LIST USERS (paginated, filterable)
    // ============================================
    async listUsers(filters = {}) {
        const { search, role, status, page = 1, limit = 50 } = filters;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (search) {
            conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }
        if (role) {
            conditions.push(`u.role = $${idx}`);
            params.push(role);
            idx++;
        }
        if (status === 'active') {
            conditions.push('u.is_active = true');
        } else if (status === 'inactive') {
            conditions.push('u.is_active = false');
        } else if (status === 'locked') {
            conditions.push('u.locked_until > NOW()');
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = (page - 1) * limit;

        const countQ = await db.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, params);

        const usersQ = await db.query(`
            SELECT u.id, u.email, u.name, u.role, u.department, u.phone, u.timezone,
                   u.is_active, u.last_login_at, u.created_at, u.updated_at,
                   u.failed_login_count, u.locked_until, u.password_changed_at,
                   u.deactivated_at, u.avatar_url,
                   inv.name AS invited_by_name
            FROM users u
            LEFT JOIN users inv ON u.invited_by = inv.id
            ${where}
            ORDER BY u.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `, params);

        return {
            users: usersQ.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countQ.rows[0].total,
                pages: Math.ceil(countQ.rows[0].total / limit),
            },
        };
    }

    // ============================================
    // GET USER BY ID (with login summary)
    // ============================================
    async getUser(id) {
        const { rows } = await db.query(`
            SELECT id, email, name, role, department, phone, timezone, avatar_url,
                   is_active, last_login_at, created_at, updated_at,
                   failed_login_count, locked_until, password_changed_at,
                   deactivated_at, deactivated_by
            FROM users WHERE id = $1
        `, [id]);

        if (rows.length === 0) throw new AppError('User not found', 404);

        // Login stats
        const loginStats = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'success')::int AS successful_logins,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_logins,
                MAX(created_at) FILTER (WHERE status = 'success') AS last_successful_login,
                MAX(created_at) FILTER (WHERE status = 'failed') AS last_failed_login
            FROM login_history WHERE user_id = $1
        `, [id]);

        // Active sessions count
        const sessionCount = await db.query(
            `SELECT COUNT(*)::int AS active_sessions FROM user_sessions
             WHERE user_id = $1 AND is_active = true AND expires_at > NOW()`,
            [id]
        );

        return {
            ...rows[0],
            login_stats: loginStats.rows[0] || {},
            active_sessions: sessionCount.rows[0]?.active_sessions || 0,
        };
    }

    // ============================================
    // CREATE USER
    // ============================================
    async createUser(data, createdBy = null) {
        this.validatePassword(data.password);

        // Check for duplicate email
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [data.email]);
        if (existing.rows.length > 0) {
            throw new AppError('Email already registered', 409);
        }

        const passwordHash = await bcrypt.hash(data.password, 10);

        const result = await db.query(`
            INSERT INTO users (email, password_hash, name, role, department, phone, timezone, invited_by, password_changed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, email, name, role, department, phone, timezone, is_active, created_at
        `, [
            data.email,
            passwordHash,
            data.name,
            data.role || 'viewer',
            data.department || null,
            data.phone || null,
            data.timezone || 'UTC',
            createdBy,
        ]);

        logger.info(`User created: ${data.email} (role: ${data.role || 'viewer'}) by ${createdBy || 'system'}`);
        return result.rows[0];
    }

    // ============================================
    // UPDATE USER
    // ============================================
    async updateUser(id, data, updatedBy = null) {
        const fields = [];
        const params = [];
        let idx = 1;

        const allowedFields = ['name', 'department', 'phone', 'timezone', 'avatar_url'];
        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                fields.push(`${field} = $${idx}`);
                params.push(data[field]);
                idx++;
            }
        }

        // Role change requires admin
        if (data.role) {
            // Prevent changing super_admin role
            const current = await db.query('SELECT role FROM users WHERE id = $1', [id]);
            if (current.rows.length === 0) throw new AppError('User not found', 404);
            if (current.rows[0].role === 'super_admin' && data.role !== 'super_admin') {
                throw new AppError('Cannot change super_admin role', 403);
            }
            fields.push(`role = $${idx}`);
            params.push(data.role);
            idx++;
        }

        if (fields.length === 0) throw new AppError('No fields to update', 400);

        fields.push(`updated_at = NOW()`);
        params.push(id);

        const result = await db.query(`
            UPDATE users SET ${fields.join(', ')}
            WHERE id = $${idx}
            RETURNING id, email, name, role, department, phone, timezone, is_active, updated_at
        `, params);

        if (result.rows.length === 0) throw new AppError('User not found', 404);

        logger.info(`User updated: ${result.rows[0].email} by ${updatedBy || 'system'}`);
        return result.rows[0];
    }

    // ============================================
    // TOGGLE USER STATUS (activate/deactivate)
    // ============================================
    async toggleUserStatus(id, deactivatedBy = null) {
        // Prevent self-deactivation
        if (id === deactivatedBy) {
            throw new AppError('Cannot deactivate your own account', 400);
        }

        const current = await db.query('SELECT is_active, role, email FROM users WHERE id = $1', [id]);
        if (current.rows.length === 0) throw new AppError('User not found', 404);
        if (current.rows[0].role === 'super_admin') {
            throw new AppError('Cannot deactivate super_admin account', 403);
        }

        const newStatus = !current.rows[0].is_active;
        const result = await db.query(`
            UPDATE users SET
                is_active = $1,
                deactivated_at = $2,
                deactivated_by = $3,
                updated_at = NOW()
            WHERE id = $4
            RETURNING id, email, name, role, is_active, deactivated_at
        `, [
            newStatus,
            newStatus ? null : new Date(),
            newStatus ? null : deactivatedBy,
            id,
        ]);

        // Revoke all sessions if deactivating
        if (!newStatus) {
            await db.query(
                'UPDATE user_sessions SET is_active = false WHERE user_id = $1',
                [id]
            );
        }

        logger.info(`User ${newStatus ? 'activated' : 'deactivated'}: ${result.rows[0].email}`);
        return result.rows[0];
    }

    // ============================================
    // ADMIN RESET PASSWORD
    // ============================================
    async resetPassword(id, resetBy = null) {
        const user = await db.query('SELECT email, role FROM users WHERE id = $1', [id]);
        if (user.rows.length === 0) throw new AppError('User not found', 404);
        if (user.rows[0].role === 'super_admin' && resetBy !== id) {
            throw new AppError('Cannot reset super_admin password', 403);
        }

        // Generate temporary password
        const tempPassword = `Tmp${crypto.randomBytes(4).toString('hex')}!${Math.floor(Math.random() * 90 + 10)}`;
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        await db.query(`
            UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
            WHERE id = $2
        `, [passwordHash, id]);

        // Revoke all sessions
        await db.query('UPDATE user_sessions SET is_active = false WHERE user_id = $1', [id]);

        logger.info(`Password reset for: ${user.rows[0].email} by ${resetBy || 'system'}`);
        return { email: user.rows[0].email, temporaryPassword: tempPassword };
    }

    // ============================================
    // CHANGE OWN PASSWORD
    // ============================================
    async changePassword(userId, currentPassword, newPassword) {
        this.validatePassword(newPassword);

        const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (rows.length === 0) throw new AppError('User not found', 404);

        const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!valid) throw new AppError('Current password is incorrect', 401);

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await db.query(`
            UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
            WHERE id = $2
        `, [passwordHash, userId]);

        logger.info(`Password changed for user: ${userId}`);
        return { message: 'Password changed successfully' };
    }

    // ============================================
    // DELETE USER (soft-delete)
    // ============================================
    async deleteUser(id, deletedBy = null) {
        const user = await db.query('SELECT email, role FROM users WHERE id = $1', [id]);
        if (user.rows.length === 0) throw new AppError('User not found', 404);
        if (user.rows[0].role === 'super_admin') {
            throw new AppError('Cannot delete super_admin account', 403);
        }
        if (id === deletedBy) {
            throw new AppError('Cannot delete your own account', 400);
        }

        await db.query(`
            UPDATE users SET
                is_active = false,
                deactivated_at = NOW(),
                deactivated_by = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [deletedBy, id]);

        // Revoke all sessions
        await db.query('UPDATE user_sessions SET is_active = false WHERE user_id = $1', [id]);

        logger.info(`User soft-deleted: ${user.rows[0].email} by ${deletedBy || 'system'}`);
        return { message: 'User deleted' };
    }

    // ============================================
    // LOGIN HISTORY
    // ============================================
    async getLoginHistory(userId, limit = 50) {
        const { rows } = await db.query(`
            SELECT id, email, status, ip_address, user_agent, failure_reason, created_at
            FROM login_history
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [userId, limit]);
        return rows;
    }

    async getAllLoginHistory(filters = {}) {
        const { page = 1, limit = 50, status } = filters;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status) {
            conditions.push(`lh.status = $${idx}`);
            params.push(status);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = (page - 1) * limit;

        const countQ = await db.query(`SELECT COUNT(*)::int AS total FROM login_history lh ${where}`, params);
        const historyQ = await db.query(`
            SELECT lh.id, lh.email, lh.status, lh.ip_address, lh.user_agent,
                   lh.failure_reason, lh.created_at,
                   u.name AS user_name, u.role AS user_role
            FROM login_history lh
            LEFT JOIN users u ON lh.user_id = u.id
            ${where}
            ORDER BY lh.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `, params);

        return {
            history: historyQ.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countQ.rows[0].total,
                pages: Math.ceil(countQ.rows[0].total / limit),
            },
        };
    }

    // ============================================
    // SESSION MANAGEMENT
    // ============================================
    async getActiveSessions(userId) {
        const { rows } = await db.query(`
            SELECT id, ip_address, user_agent, device_label, last_activity, created_at, expires_at
            FROM user_sessions
            WHERE user_id = $1 AND is_active = true AND expires_at > NOW()
            ORDER BY last_activity DESC
        `, [userId]);
        return rows;
    }

    async revokeSession(sessionId, userId = null) {
        const conditions = ['id = $1'];
        const params = [sessionId];
        // If userId provided, ensure user can only revoke own sessions
        if (userId) {
            conditions.push('user_id = $2');
            params.push(userId);
        }
        const result = await db.query(
            `UPDATE user_sessions SET is_active = false WHERE ${conditions.join(' AND ')} RETURNING id`,
            params
        );
        if (result.rows.length === 0) throw new AppError('Session not found', 404);
        return { message: 'Session revoked' };
    }

    async revokeAllSessions(userId) {
        await db.query(
            'UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND is_active = true',
            [userId]
        );
        return { message: 'All sessions revoked' };
    }

    // ============================================
    // SYSTEM STATS
    // ============================================
    async getSystemStats() {
        const tableCountsQ = await db.query(`
            SELECT
                (SELECT COUNT(*)::int FROM users) AS users,
                (SELECT COUNT(*)::int FROM users WHERE is_active = true) AS active_users,
                (SELECT COUNT(*)::int FROM agents) AS agents,
                (SELECT COUNT(*)::int FROM policies) AS policies,
                (SELECT COUNT(*)::int FROM workflows) AS workflows,
                (SELECT COUNT(*)::int FROM audit_log) AS audit_records,
                (SELECT COUNT(*)::int FROM cost_records) AS cost_records,
                (SELECT COUNT(*)::int FROM compliance_checks) AS compliance_checks,
                (SELECT COUNT(*)::int FROM eval_runs) AS eval_runs,
                (SELECT COUNT(*)::int FROM login_history) AS login_attempts,
                (SELECT COUNT(*)::int FROM user_sessions WHERE is_active = true) AS active_sessions,
                (SELECT COUNT(*)::int FROM api_keys WHERE is_active = true) AS api_keys,
                (SELECT COUNT(*)::int FROM user_invitations WHERE status = 'pending') AS pending_invitations
        `);

        const dbSizeQ = await db.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size
        `);

        const migrationsQ = await db.query(`
            SELECT filename, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 5
        `);

        const uptimeQ = await db.query(`
            SELECT date_trunc('second', NOW() - pg_postmaster_start_time()) AS uptime
        `);

        return {
            tables: tableCountsQ.rows[0],
            database: {
                size: dbSizeQ.rows[0].db_size,
                name: 'agentshield',
                uptime: uptimeQ.rows[0].uptime,
            },
            recent_migrations: migrationsQ.rows,
            server: {
                node_version: process.version,
                platform: process.platform,
                memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                pid: process.pid,
            },
        };
    }
}

module.exports = new UserService();
