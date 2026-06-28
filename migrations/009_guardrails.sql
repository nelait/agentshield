-- ============================================
-- GUARDRAILS MODULE — Migration 009
-- Agent-level input/output guardrails with
-- configurable profiles, rules, and test runs.
-- ============================================

-- Guardrail Profiles: Named collections of rules, assignable to agents
CREATE TABLE IF NOT EXISTS guardrail_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    mode            VARCHAR(20) NOT NULL DEFAULT 'block'
                    CHECK (mode IN ('block', 'log_only')),
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Individual guardrail rules within a profile
CREATE TABLE IF NOT EXISTS guardrail_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES guardrail_profiles(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    rule_type       VARCHAR(30) NOT NULL
                    CHECK (rule_type IN (
                        'content_filter',
                        'topic_boundary',
                        'pii_shield',
                        'prompt_injection',
                        'output_format',
                        'token_limit',
                        'custom_regex',
                        'llm_judge'
                    )),
    scope           VARCHAR(10) NOT NULL DEFAULT 'both'
                    CHECK (scope IN ('input', 'output', 'both')),
    config          JSONB NOT NULL DEFAULT '{}',
    severity        VARCHAR(10) DEFAULT 'high'
                    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    is_enabled      BOOLEAN DEFAULT true,
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Agent-to-Profile assignments (many-to-many)
CREATE TABLE IF NOT EXISTS agent_guardrails (
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    profile_id      UUID NOT NULL REFERENCES guardrail_profiles(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ DEFAULT NOW(),
    assigned_by     UUID REFERENCES users(id),
    PRIMARY KEY (agent_id, profile_id)
);

-- Guardrail test runs — tracks test execution results
CREATE TABLE IF NOT EXISTS guardrail_test_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES guardrail_profiles(id) ON DELETE CASCADE,
    agent_id        UUID REFERENCES agents(id),
    status          VARCHAR(20) DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed')),
    total_tests     INT DEFAULT 0,
    passed_tests    INT DEFAULT 0,
    failed_tests    INT DEFAULT 0,
    results         JSONB DEFAULT '[]',
    run_by          UUID REFERENCES users(id),
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_guardrail_rules_profile ON guardrail_rules(profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_guardrails_agent ON agent_guardrails(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_guardrails_profile ON agent_guardrails(profile_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_test_runs_profile ON guardrail_test_runs(profile_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_test_runs_agent ON guardrail_test_runs(agent_id);
