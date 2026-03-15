-- ============================================
-- AgentShield Migration: 002_compliance_checks
-- Enhanced compliance: check results + sample tracking
-- ============================================

CREATE TABLE compliance_checks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id       UUID NOT NULL REFERENCES compliance_configs(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'running'
                    CHECK (status IN ('running', 'passed', 'failed', 'partial')),
    total_rules     INT DEFAULT 0,
    passed_rules    INT DEFAULT 0,
    failed_rules    INT DEFAULT 0,
    results         JSONB DEFAULT '[]',
    samples_used    JSONB DEFAULT '[]',
    sample_source   VARCHAR(20) DEFAULT 'generated'
                    CHECK (sample_source IN ('generated', 'uploaded', 'mixed')),
    run_by          UUID REFERENCES users(id),
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_compliance_checks_config ON compliance_checks(config_id);
CREATE INDEX idx_compliance_checks_status ON compliance_checks(status);

-- Add applies_to columns for better querying on compliance_configs
-- (the JSONB field already exists, this adds convenience columns)
ALTER TABLE compliance_configs ADD COLUMN IF NOT EXISTS description TEXT;
