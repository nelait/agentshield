-- ============================================
-- Migration: 007_cost_enhancements.sql
-- Adds budget_history table for period archiving
-- and extends scope_type to support agent/workflow
-- ============================================

-- Budget period history archive
CREATE TABLE IF NOT EXISTS budget_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    budget_name     VARCHAR(255) NOT NULL,
    scope_type      VARCHAR(20) NOT NULL,
    scope_id        VARCHAR(255) NOT NULL,
    period          VARCHAR(20) NOT NULL,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    final_tokens    BIGINT DEFAULT 0,
    final_cost_cents BIGINT DEFAULT 0,
    token_limit     BIGINT,
    cost_limit_cents BIGINT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_history_budget ON budget_history(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_history_period ON budget_history(period_end);

-- Extend scope_type to include 'agent' and 'workflow'
-- Drop the old constraint and add the new one
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_scope_type_check;
ALTER TABLE budgets ADD CONSTRAINT budgets_scope_type_check
    CHECK (scope_type IN ('user', 'team', 'department', 'project', 'global', 'agent', 'workflow'));
