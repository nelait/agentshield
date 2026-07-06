const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

// Account lockout settings
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

class AuthService {
    /**
     * Login with email and password — enhanced with login history,
     * account lockout, and session tracking.
     */
    async login(email, password, meta = {}) {
        const ipAddress = meta.ip || null;
        const userAgent = meta.userAgent || null;

        // Find user (including inactive to differentiate error messages)
        const { rows } = await db.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // No user found
        if (rows.length === 0) {
            await this._recordLoginAttempt(null, email, 'failed', ipAddress, userAgent, 'User not found');
            throw new AppError('Invalid email or password', 401);
        }

        const user = rows[0];

        // Account inactive
        if (!user.is_active) {
            await this._recordLoginAttempt(user.id, email, 'failed', ipAddress, userAgent, 'Account deactivated');
            throw new AppError('Account is deactivated. Contact your administrator.', 403);
        }

        // Account locked
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            await this._recordLoginAttempt(user.id, email, 'locked', ipAddress, userAgent, 'Account locked');
            const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
            throw new AppError(`Account is locked. Try again in ${remaining} minute(s).`, 423);
        }

        // Verify password
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            // Increment failed count
            const newCount = (user.failed_login_count || 0) + 1;
            const lockUntil = newCount >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                : null;

            await db.query(
                `UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3`,
                [newCount, lockUntil, user.id]
            );

            await this._recordLoginAttempt(
                user.id, email,
                lockUntil ? 'locked' : 'failed',
                ipAddress, userAgent,
                lockUntil ? `Locked after ${newCount} failed attempts` : 'Invalid password'
            );

            if (lockUntil) {
                throw new AppError(`Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`, 423);
            }

            throw new AppError('Invalid email or password', 401);
        }

        // Successful login — reset failed count and update last_login
        await db.query(
            `UPDATE users SET last_login_at = NOW(), failed_login_count = 0, locked_until = NULL WHERE id = $1`,
            [user.id]
        );

        const token = this.generateToken(user);
        const refreshToken = this.generateRefreshToken(user);

        // Record successful login
        await this._recordLoginAttempt(user.id, email, 'success', ipAddress, userAgent, null);

        // Track session
        await this._createSession(user.id, token, refreshToken, ipAddress, userAgent);

        logger.info(`User logged in: ${email}`);

        return {
            token,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                department: user.department,
            },
        };
    }

    /**
     * Register a new user (admin only) — delegates to UserService for new code,
     * kept for backward compat with existing routes.
     */
    async createUser(data) {
        const passwordHash = await bcrypt.hash(data.password, 10);

        const result = await db.query(
            `INSERT INTO users (email, password_hash, name, role, department)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, department, created_at`,
            [data.email, passwordHash, data.name, data.role || 'viewer', data.department || null]
        );

        return result.rows[0];
    }

    /**
     * List users
     */
    async listUsers() {
        const result = await db.query(
            'SELECT id, email, name, role, department, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC'
        );
        return result.rows;
    }

    generateToken(user) {
        return jwt.sign(
            { id: user.id, email: user.email, role: user.role, department: user.department },
            config.jwt.secret,
            { expiresIn: config.jwt.expiresIn }
        );
    }

    generateRefreshToken(user) {
        return jwt.sign(
            { id: user.id, type: 'refresh' },
            config.jwt.secret,
            { expiresIn: config.jwt.refreshExpiresIn }
        );
    }

    async refreshToken(refreshToken) {
        try {
            const decoded = jwt.verify(refreshToken, config.jwt.secret);
            if (decoded.type !== 'refresh') throw new Error('Invalid token type');

            const { rows } = await db.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
            if (rows.length === 0) throw new Error('User not found');

            return { token: this.generateToken(rows[0]) };
        } catch (err) {
            throw new AppError('Invalid refresh token', 401);
        }
    }

    // ============================================
    // INTERNAL HELPERS
    // ============================================

    /**
     * Record a login attempt in login_history
     */
    async _recordLoginAttempt(userId, email, status, ipAddress, userAgent, failureReason) {
        try {
            await db.query(`
                INSERT INTO login_history (user_id, email, status, ip_address, user_agent, failure_reason)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [userId, email, status, ipAddress, userAgent, failureReason]);
        } catch (err) {
            // Non-critical — don't break login flow
            logger.warn(`Failed to record login attempt: ${err.message}`);
        }
    }

    /**
     * Create a session entry for tracking
     */
    async _createSession(userId, token, refreshToken, ipAddress, userAgent) {
        try {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const refreshHash = refreshToken
                ? crypto.createHash('sha256').update(refreshToken).digest('hex')
                : null;

            // Parse device label from user-agent
            const deviceLabel = this._parseDeviceLabel(userAgent);

            // Calculate expiry from JWT config
            const expiresIn = config.jwt.expiresIn || '15m';
            const ms = this._parseExpiry(expiresIn);
            const expiresAt = new Date(Date.now() + ms);

            await db.query(`
                INSERT INTO user_sessions (user_id, token_hash, refresh_hash, ip_address, user_agent, device_label, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [userId, tokenHash, refreshHash, ipAddress, userAgent, deviceLabel, expiresAt]);
        } catch (err) {
            logger.warn(`Failed to create session: ${err.message}`);
        }
    }

    _parseDeviceLabel(ua) {
        if (!ua) return 'Unknown';
        if (ua.includes('Chrome')) return ua.includes('Mac') ? 'Chrome on macOS' : ua.includes('Windows') ? 'Chrome on Windows' : 'Chrome';
        if (ua.includes('Firefox')) return ua.includes('Mac') ? 'Firefox on macOS' : 'Firefox';
        if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari on macOS';
        if (ua.includes('curl')) return 'API Client (curl)';
        return 'Unknown Client';
    }

    _parseExpiry(str) {
        const num = parseInt(str);
        if (str.endsWith('h')) return num * 60 * 60 * 1000;
        if (str.endsWith('d')) return num * 24 * 60 * 60 * 1000;
        return num * 60 * 1000; // default: minutes
    }
}

module.exports = new AuthService();
