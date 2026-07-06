-- ============================================
-- REPORTS MODULE — Migration 012
-- Saved report configurations and historical
-- snapshots for the Reports engine.
-- ============================================

-- Report configurations (saved/scheduled reports)
CREATE TABLE IF NOT EXISTS report_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    report_type     VARCHAR(50) NOT NULL
                    CHECK (report_type IN (
                        'access_decisions', 'policy_effectiveness', 'anomaly_detection',
                        'compliance_posture', 'compliance_history', 'pii_exposure', 'audit_export',
                        'cost_overview', 'budget_utilization', 'token_usage',
                        'agent_health', 'agent_scorecard', 'agent_invocations',
                        'guardrail_violations', 'guardrail_coverage',
                        'governance_posture', 'workflow_execution'
                    )),
    filters         JSONB DEFAULT '{}',
    schedule        VARCHAR(30) CHECK (schedule IN ('daily', 'weekly', 'monthly') OR schedule IS NULL),
    recipients      JSONB DEFAULT '[]',
    last_generated  TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Report snapshots (generated report data for historical access)
CREATE TABLE IF NOT EXISTS report_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id       UUID REFERENCES report_configs(id) ON DELETE SET NULL,
    report_type     VARCHAR(50) NOT NULL,
    name            VARCHAR(255),
    filters         JSONB DEFAULT '{}',
    data            JSONB NOT NULL,
    generated_by    UUID REFERENCES users(id),
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_report_configs_type ON report_configs(report_type);
CREATE INDEX IF NOT EXISTS idx_report_configs_user ON report_configs(created_by);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_type ON report_snapshots(report_type);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_generated ON report_snapshots(generated_at);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_config ON report_snapshots(config_id);
