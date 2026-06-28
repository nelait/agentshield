-- ============================================
-- AgentShield Migration: 006_api_keys
-- API Keys for Self-Service Policy Validation
-- ============================================

CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    key_hash        VARCHAR(64) NOT NULL UNIQUE,
    key_prefix      VARCHAR(12) NOT NULL,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    role            VARCHAR(50) DEFAULT 'viewer'
                    CHECK (role IN ('super_admin', 'admin', 'editor', 'viewer')),
    scopes          JSONB DEFAULT '["policy:check"]',
    is_active       BOOLEAN DEFAULT true,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_id);
