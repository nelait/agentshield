-- ============================================
-- AgentShield Migration: 005_evaluation
-- Three-Layer Agent Evaluation Framework
-- ============================================

-- ============================================
-- EVALUATION SUITES
-- ============================================
CREATE TABLE IF NOT EXISTS eval_suites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
    eval_mode       VARCHAR(20) NOT NULL DEFAULT 'test_suite'
                    CHECK (eval_mode IN ('test_suite', 'simulation', 'golden_set')),
    scenarios       JSONB DEFAULT '[]',
    persona_config  JSONB DEFAULT '{}',
    is_locked       BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_suites_agent ON eval_suites(agent_id);
CREATE INDEX IF NOT EXISTS idx_eval_suites_mode ON eval_suites(eval_mode);
CREATE INDEX IF NOT EXISTS idx_eval_suites_active ON eval_suites(is_active);

-- ============================================
-- EVALUATION RUNS
-- ============================================
CREATE TABLE IF NOT EXISTS eval_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id        UUID NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
    agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
    status          VARCHAR(20) DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'pending_review')),
    eval_mode       VARCHAR(20) NOT NULL DEFAULT 'test_suite',
    judge_model     VARCHAR(100),
    total_scenarios  INT DEFAULT 0,
    passed_scenarios INT DEFAULT 0,
    failed_scenarios INT DEFAULT 0,
    needs_review    INT DEFAULT 0,
    node_scores     JSONB DEFAULT '{}',
    session_scores  JSONB DEFAULT '{}',
    system_scores   JSONB DEFAULT '{}',
    overall_score   DECIMAL(5,2) DEFAULT 0,
    results         JSONB DEFAULT '[]',
    run_by          UUID REFERENCES users(id),
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_suite ON eval_runs(suite_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_status ON eval_runs(status);
CREATE INDEX IF NOT EXISTS idx_eval_runs_agent ON eval_runs(agent_id);

-- ============================================
-- EVALUATION REVIEWS (HITL)
-- ============================================
CREATE TABLE IF NOT EXISTS eval_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    scenario_id     VARCHAR(50) NOT NULL,
    review_reason   VARCHAR(50) NOT NULL
                    CHECK (review_reason IN ('low_confidence', 'golden_set_failure', 'flagged_edge_case')),
    original_score  DECIMAL(5,2),
    reviewed_score  DECIMAL(5,2),
    review_action   VARCHAR(30)
                    CHECK (review_action IN ('approved', 'overridden', 'added_to_golden_set', 'flagged_known_issue')),
    reviewer_notes  TEXT,
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_reviews_run ON eval_reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_reviews_pending ON eval_reviews(review_action) WHERE review_action IS NULL;
