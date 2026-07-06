const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

/**
 * InviteService — Email-based user invitation system
 */
class InviteService {

    static INVITE_EXPIRY_DAYS = 7;

    // ============================================
    // CREATE INVITATION
    // ============================================
    async createInvitation({ email, role, department, invitedBy }) {
        // Check if user already exists
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            throw new AppError('User with this email already exists', 409);
        }

        // Check for existing pending invitation
        const pendingInvite = await db.query(
            `SELECT id FROM user_invitations WHERE email = $1 AND status = 'pending' AND expires_at > NOW()`,
            [email]
        );
        if (pendingInvite.rows.length > 0) {
            throw new AppError('A pending invitation already exists for this email', 409);
        }

        // Prevent inviting as super_admin
        if (role === 'super_admin') {
            throw new AppError('Cannot invite users as super_admin', 403);
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + InviteService.INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        const result = await db.query(`
            INSERT INTO user_invitations (email, role, department, invited_by, token, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, email, role, department, token, status, expires_at, created_at
        `, [email, role || 'viewer', department || null, invitedBy, token, expiresAt]);

        logger.info(`Invitation sent to ${email} (role: ${role}) by ${invitedBy}`);

        return result.rows[0];
    }

    // ============================================
    // LIST INVITATIONS
    // ============================================
    async listInvitations(filters = {}) {
        const { status } = filters;
        let query = `
            SELECT inv.id, inv.email, inv.role, inv.department, inv.token,
                   inv.status, inv.expires_at, inv.accepted_at, inv.created_at,
                   u.name AS invited_by_name, u.email AS invited_by_email
            FROM user_invitations inv
            LEFT JOIN users u ON inv.invited_by = u.id
        `;
        const params = [];

        if (status) {
            query += ' WHERE inv.status = $1';
            params.push(status);
        }

        query += ' ORDER BY inv.created_at DESC';

        const { rows } = await db.query(query, params);

        // Auto-expire old invitations
        await db.query(`
            UPDATE user_invitations
            SET status = 'expired'
            WHERE status = 'pending' AND expires_at < NOW()
        `);

        return rows;
    }

    // ============================================
    // ACCEPT INVITATION
    // ============================================
    async acceptInvitation({ token, password, name }) {
        const { rows } = await db.query(
            `SELECT * FROM user_invitations WHERE token = $1 AND status = 'pending'`,
            [token]
        );

        if (rows.length === 0) {
            throw new AppError('Invalid or expired invitation', 400);
        }

        const invite = rows[0];

        if (new Date(invite.expires_at) < new Date()) {
            await db.query(`UPDATE user_invitations SET status = 'expired' WHERE id = $1`, [invite.id]);
            throw new AppError('Invitation has expired', 400);
        }

        // Validate password
        const userService = require('./userService');
        userService.validatePassword(password);

        // Create user
        const passwordHash = await bcrypt.hash(password, 10);
        const userResult = await db.query(`
            INSERT INTO users (email, password_hash, name, role, department, invited_by, password_changed_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id, email, name, role, department, created_at
        `, [invite.email, passwordHash, name, invite.role, invite.department, invite.invited_by]);

        // Mark invitation as accepted
        await db.query(`
            UPDATE user_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1
        `, [invite.id]);

        logger.info(`Invitation accepted: ${invite.email} → user created with role ${invite.role}`);

        return userResult.rows[0];
    }

    // ============================================
    // REVOKE INVITATION
    // ============================================
    async revokeInvitation(id) {
        const result = await db.query(`
            UPDATE user_invitations SET status = 'revoked'
            WHERE id = $1 AND status = 'pending'
            RETURNING id, email
        `, [id]);

        if (result.rows.length === 0) {
            throw new AppError('Invitation not found or already processed', 404);
        }

        logger.info(`Invitation revoked: ${result.rows[0].email}`);
        return { message: 'Invitation revoked' };
    }
}

module.exports = new InviteService();
