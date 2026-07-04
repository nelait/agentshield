-- ============================================
-- GUARDRAILS — Migration 010
-- Add unique constraint on profile names
-- ============================================

-- Enforce unique profile names (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_guardrail_profiles_name_unique
    ON guardrail_profiles (LOWER(name));
