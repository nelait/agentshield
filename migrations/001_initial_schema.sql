-- ============================================
-- AgentShield Database Schema
-- Migration: 001_initial_schema.sql
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS (Admin & API Users)
-- ============================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(255),
    role            VARCHAR(30) NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('super_admin', 'admin', 'editor', 'viewer')),
    department      VARCHAR(255),
    is_active       BOOLEAN DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AGENT REGISTRY
-- ============================================
CREATE TABLE agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('external', 'internal')),
    vendor          VARCHAR(255),
    description     TEXT,
    protocol        VARCHAR(20) NOT NULL CHECK (protocol IN ('a2a', 'mcp', 'rest', 'grpc')),
    endpoint_url    TEXT NOT NULL,
    auth_config     JSONB DEFAULT '{}',
    capabilities    JSONB DEFAULT '[]',
    health_status   VARCHAR(20) DEFAULT 'unknown'
                    CHECK (health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
    health_check_url TEXT,
    consecutive_failures INT DEFAULT 0,
    last_health_check TIMESTAMPTZ,
    version         VARCHAR(50),
    is_active       BOOLEAN DEFAULT true,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

CREATE INDEX idx_agents_slug ON agents(slug);
CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_agents_active ON agents(is_active);

-- ============================================
-- WORKFLOWS
-- ============================================
CREATE TABLE workflows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    is_enabled      BOOLEAN DEFAULT true,
    max_concurrent  INT DEFAULT 10,
    daily_limit     INT,
    requires_approval BOOLEAN DEFAULT false,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

CREATE TABLE workflow_agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    step_order      INT NOT NULL,
    is_optional     BOOLEAN DEFAULT false,
    config          JSONB DEFAULT '{}',
    data_flow_rules JSONB DEFAULT '{}',
    UNIQUE(workflow_id, step_order)
);

CREATE INDEX idx_workflow_agents_workflow ON workflow_agents(workflow_id);

-- ============================================
-- AUTH POLICIES
-- ============================================
CREATE TABLE policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    policy_type     VARCHAR(30) NOT NULL CHECK (policy_type IN (
                        'access_control', 'data_flow', 'budget', 'rate_limit', 'guardrail'
                    )),
    rules_json      JSONB NOT NULL,
    compiled_policy TEXT,
    applies_to      JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    priority        INT DEFAULT 100,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

CREATE INDEX idx_policies_type ON policies(policy_type);
CREATE INDEX idx_policies_active ON policies(is_active);

-- ============================================
-- COST / TOKEN BUDGETS
-- ============================================
CREATE TABLE budgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    scope_type      VARCHAR(20) NOT NULL CHECK (scope_type IN ('user', 'team', 'department', 'project', 'global')),
    scope_id        VARCHAR(255) NOT NULL,
    token_limit     BIGINT,
    cost_limit_cents BIGINT,
    period          VARCHAR(20) NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'quarterly')),
    warn_threshold  DECIMAL(3,2) DEFAULT 0.80,
    hard_limit      BOOLEAN DEFAULT true,
    current_tokens  BIGINT DEFAULT 0,
    current_cost_cents BIGINT DEFAULT 0,
    period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budgets_scope ON budgets(scope_type, scope_id);

-- ============================================
-- COMPLIANCE SAMPLING CONFIG
-- ============================================
CREATE TABLE compliance_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    framework       VARCHAR(20) NOT NULL CHECK (framework IN ('sox', 'hipaa', 'gdpr', 'pci_dss', 'custom')),
    sample_rate     DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
    applies_to      JSONB DEFAULT '{}',
    retention_days  INT NOT NULL DEFAULT 2190,
    pii_detection   BOOLEAN DEFAULT true,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- COMPLIANCE SAMPLES
-- ============================================
CREATE TABLE compliance_samples (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id       UUID REFERENCES compliance_configs(id),
    trace_id        UUID NOT NULL,
    request_hash    CHAR(64) NOT NULL,
    request_body    BYTEA,
    response_hash   CHAR(64) NOT NULL,
    response_body   BYTEA,
    agent_id        UUID REFERENCES agents(id),
    workflow_id     UUID REFERENCES workflows(id),
    user_id         UUID,
    pii_detected    BOOLEAN DEFAULT false,
    pii_types       JSONB DEFAULT '[]',
    flagged         BOOLEAN DEFAULT false,
    flag_reason     TEXT,
    sampled_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_compliance_samples_trace ON compliance_samples(trace_id);
CREATE INDEX idx_compliance_samples_flagged ON compliance_samples(flagged) WHERE flagged = true;

-- ============================================
-- AUDIT LOG (Append-only)
-- ============================================
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    trace_id        UUID NOT NULL,
    event_type      VARCHAR(50) NOT NULL,
    actor_id        UUID,
    actor_type      VARCHAR(20),
    resource_type   VARCHAR(50),
    resource_id     UUID,
    action          VARCHAR(50) NOT NULL,
    outcome         VARCHAR(20) NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error', 'info')),
    details         JSONB DEFAULT '{}',
    ip_address      INET,
    latency_ms      INT,
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_trace ON audit_log(trace_id);
CREATE INDEX idx_audit_log_recorded ON audit_log(recorded_at);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_log_outcome ON audit_log(outcome);

-- Prevent updates/deletes on audit log (append-only)
CREATE RULE audit_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ============================================
-- COST USAGE RECORDS
-- ============================================
CREATE TABLE cost_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id        UUID NOT NULL,
    agent_id        UUID REFERENCES agents(id),
    workflow_id     UUID REFERENCES workflows(id),
    user_id         UUID,
    input_tokens    INT DEFAULT 0,
    output_tokens   INT DEFAULT 0,
    total_tokens    INT DEFAULT 0,
    cost_cents      INT DEFAULT 0,
    model_name      VARCHAR(255),
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cost_records_user ON cost_records(user_id);
CREATE INDEX idx_cost_records_recorded ON cost_records(recorded_at);

-- ============================================
-- SEED DEFAULT ADMIN USER
-- password: admin123 (bcrypt hash)
-- ============================================
INSERT INTO users (email, password_hash, name, role)
VALUES (
    'admin@agentshield.local',
    '$2a$10$rQXjD6K7E8kY5H9X3gH6YOwUf6Nf8JhP3KjYpN5ZxXm3dQ0sYtJ6i',
    'System Admin',
    'super_admin'
) ON CONFLICT (email) DO NOTHING;
