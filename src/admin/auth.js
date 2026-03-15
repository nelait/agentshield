const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

class AuthService {
    /**
     * Login with email and password
     */
    async login(email, password) {
        const { rows } = await db.query(
            'SELECT * FROM users WHERE email = $1 AND is_active = true',
            [email]
        );

        if (rows.length === 0) {
            throw new AppError('Invalid email or password', 401);
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            throw new AppError('Invalid email or password', 401);
        }

        // Update last login
        await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        const token = this.generateToken(user);
        const refreshToken = this.generateRefreshToken(user);

        logger.info(`User logged in: ${email}`);

        return {
            token,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
        };
    }

    /**
     * Register a new user (admin only)
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
}

module.exports = new AuthService();
