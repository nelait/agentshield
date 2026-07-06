-- ============================================
-- 013: Admin Module — User Management Enhancement
-- ============================================
-- Login history, active sessions, invitations,
-- and user table enhancements for the Admin module.
-- ============================================

-- ============================================
-- LOGIN HISTORY (full login attempt tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS login_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    email           VARCHAR(255) NOT NULL,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('success','failed','locked')),
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    failure_reason  VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_email ON login_history(email, created_at DESC);

-- ============================================
-- ACTIVE SESSIONS (JWT session tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64) NOT NULL,
    refresh_hash    VARCHAR(64),
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    device_label    VARCHAR(100),
    is_active       BOOLEAN DEFAULT true,
    last_activity   TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON user_sessions(token_hash);

-- ============================================
-- INVITATIONS (email-based user invites)
-- ============================================
CREATE TABLE IF NOT EXISTS user_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL,
    role            VARCHAR(30) NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin', 'editor', 'viewer')),
    department      VARCHAR(255),
    invited_by      UUID REFERENCES users(id),
    token           VARCHAR(64) NOT NULL UNIQUE,
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','expired','revoked')),
    accepted_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email);

-- ============================================
-- ENHANCE USERS TABLE
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES users(id);
