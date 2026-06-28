-- ============================================
-- Cost Management — Test Seed Data
-- Run after all migrations (including 007)
--
-- Creates:
--   • 5 test agents
--   • 6 budgets (user, team, department, agent, project, global)
--   • 30 days of cost_records (realistic usage patterns)
--   • 3 budget_history entries (archived periods)
-- ============================================

-- ────────────────────────────────
-- 1. TEST AGENTS
-- ────────────────────────────────
-- We need agents in the registry so cost_records can reference them.
-- Using ON CONFLICT to avoid duplicates if agents already exist.

INSERT INTO agents (id, name, slug, type, vendor, description, protocol, endpoint_url, health_status, is_active)
VALUES
    ('a0000001-0001-4000-8000-000000000001', 'GPT-4o Code Reviewer', 'gpt4o-code-reviewer', 'external', 'OpenAI', 'Automated code review agent using GPT-4o', 'rest', 'https://api.openai.com/v1/chat/completions', 'healthy', true),
    ('a0000001-0001-4000-8000-000000000002', 'Claude Sonnet Analyst', 'claude-sonnet-analyst', 'external', 'Anthropic', 'Data analysis agent using Claude 3.5 Sonnet', 'rest', 'https://api.anthropic.com/v1/messages', 'healthy', true),
    ('a0000001-0001-4000-8000-000000000003', 'Gemini Research Bot', 'gemini-research-bot', 'external', 'Google', 'Research and summarization agent', 'rest', 'https://generativelanguage.googleapis.com/v1beta', 'healthy', true),
    ('a0000001-0001-4000-8000-000000000004', 'Customer Support Agent', 'customer-support-agent', 'internal', 'Internal', 'Handles customer support tickets using GPT-4o-mini', 'rest', 'http://internal-agents:8080/support', 'healthy', true),
    ('a0000001-0001-4000-8000-000000000005', 'Compliance Checker', 'compliance-checker', 'internal', 'Internal', 'Checks documents for regulatory compliance using Gemini', 'rest', 'http://internal-agents:8080/compliance', 'degraded', true)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    vendor = EXCLUDED.vendor,
    description = EXCLUDED.description;

-- Get the admin user ID for seeding
-- (If no admin exists, we skip user-scoped data gracefully)

-- ────────────────────────────────
-- 2. BUDGETS
-- ────────────────────────────────
-- Mix of scopes, periods, usage levels, and limit types

-- Budget 1: Team budget — ML Engineering (Monthly, 75% used, hard limit)
INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit, current_tokens, current_cost_cents, period_start, is_active)
VALUES ('ML Engineering Monthly', 'team', 'ml-engineering', 50000000, 250000, 'monthly', 0.80, true,
        37500000, 187500, NOW() - INTERVAL '18 days', true);

-- Budget 2: Department budget — Engineering (Quarterly, 45% used, soft limit)
INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit, current_tokens, current_cost_cents, period_start, is_active)
VALUES ('Engineering Quarterly', 'department', 'engineering', 200000000, 1000000, 'quarterly', 0.75, false,
        90000000, 450000, NOW() - INTERVAL '40 days', true);

-- Budget 3: Global budget — Organization wide (Monthly, 30% used)
INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit, current_tokens, current_cost_cents, period_start, is_active)
VALUES ('Organization Monthly', 'global', 'global', 500000000, 2500000, 'monthly', 0.85, true,
        150000000, 750000, NOW() - INTERVAL '15 days', true);

-- Budget 4: Agent budget — GPT-4o Code Reviewer (Weekly, 92% used — alert state!)
INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit, current_tokens, current_cost_cents, period_start, is_active)
VALUES ('Code Reviewer Weekly Cap', 'agent', 'a0000001-0001-4000-8000-000000000001', 10000000, 50000, 'weekly', 0.80, true,
        9200000, 46000, NOW() - INTERVAL '5 days', true);

-- Budget 5: Project budget — Q3 Demo (Monthly, 110% exceeded — BLOCKING!)
INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit, current_tokens, current_cost_cents, period_start, is_active)
VALUES ('Q3 Demo Project', 'project', 'q3-product-demo', 20000000, 100000, 'monthly', 0.80, true,
        22000000, 110000, NOW() - INTERVAL '22 days', true);

-- Budget 6: Daily budget — Support Agent (Daily, 60% used, soft limit)
INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit, current_tokens, current_cost_cents, period_start, is_active)
VALUES ('Support Agent Daily', 'agent', 'a0000001-0001-4000-8000-000000000004', 2000000, 5000, 'daily', 0.90, false,
        1200000, 3000, NOW() - INTERVAL '12 hours', true);


-- ────────────────────────────────
-- 3. COST RECORDS (30 days of usage)
-- ────────────────────────────────
-- Generate realistic usage patterns with different models and agents.
-- Each agent has a distinct usage profile.

-- Helper: We'll use generate_series to create 30 days of data

-- Agent 1: GPT-4o Code Reviewer — heavy daily usage (code reviews)
INSERT INTO cost_records (trace_id, agent_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name, recorded_at)
SELECT
    gen_random_uuid(),
    'a0000001-0001-4000-8000-000000000001',
    (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1),
    (3000 + (random() * 5000)::int),  -- input: 3K-8K per request
    (800 + (random() * 2000)::int),   -- output: 800-2800 per request
    0, -- will be calculated
    0, -- will be calculated
    'gpt-4o',
    NOW() - (gs * INTERVAL '3 hours') + (random() * INTERVAL '2 hours')
FROM generate_series(0, 239) gs;  -- ~240 requests over 30 days (8/day)

-- Update total_tokens and estimate cost for Agent 1
UPDATE cost_records SET
    total_tokens = input_tokens + output_tokens,
    cost_cents = ((input_tokens * 250.0 / 1000000) + (output_tokens * 1000.0 / 1000000))::int
WHERE agent_id = 'a0000001-0001-4000-8000-000000000001' AND cost_cents = 0;

-- Agent 2: Claude Sonnet Analyst — moderate usage (data analysis)
INSERT INTO cost_records (trace_id, agent_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name, recorded_at)
SELECT
    gen_random_uuid(),
    'a0000001-0001-4000-8000-000000000002',
    (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1),
    (8000 + (random() * 15000)::int),  -- input: 8K-23K (large context)
    (2000 + (random() * 5000)::int),   -- output: 2K-7K
    0, 0,
    'claude-sonnet-4-20250514',
    NOW() - (gs * INTERVAL '6 hours') + (random() * INTERVAL '4 hours')
FROM generate_series(0, 119) gs;  -- ~120 requests over 30 days (4/day)

UPDATE cost_records SET
    total_tokens = input_tokens + output_tokens,
    cost_cents = ((input_tokens * 300.0 / 1000000) + (output_tokens * 1500.0 / 1000000))::int
WHERE agent_id = 'a0000001-0001-4000-8000-000000000002' AND cost_cents = 0;

-- Agent 3: Gemini Research Bot — bursty usage (research sprints)
INSERT INTO cost_records (trace_id, agent_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name, recorded_at)
SELECT
    gen_random_uuid(),
    'a0000001-0001-4000-8000-000000000003',
    (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1),
    (5000 + (random() * 20000)::int),  -- input: 5K-25K
    (3000 + (random() * 8000)::int),   -- output: 3K-11K
    0, 0,
    'gemini-2.5-pro',
    NOW() - (gs * INTERVAL '5 hours') + (random() * INTERVAL '3 hours')
FROM generate_series(0, 89) gs;  -- ~90 requests over 30 days (~3/day, bursty)

UPDATE cost_records SET
    total_tokens = input_tokens + output_tokens,
    cost_cents = ((input_tokens * 125.0 / 1000000) + (output_tokens * 1000.0 / 1000000))::int
WHERE agent_id = 'a0000001-0001-4000-8000-000000000003' AND cost_cents = 0;

-- Agent 4: Customer Support Agent — high volume, cheap (GPT-4o-mini)
INSERT INTO cost_records (trace_id, agent_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name, recorded_at)
SELECT
    gen_random_uuid(),
    'a0000001-0001-4000-8000-000000000004',
    (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1),
    (500 + (random() * 2000)::int),   -- input: 500-2500 (short messages)
    (200 + (random() * 800)::int),    -- output: 200-1000
    0, 0,
    'gpt-4o-mini',
    NOW() - (gs * INTERVAL '1 hour') + (random() * INTERVAL '30 minutes')
FROM generate_series(0, 599) gs;  -- ~600 requests over 30 days (20/day)

UPDATE cost_records SET
    total_tokens = input_tokens + output_tokens,
    cost_cents = GREATEST(1, ((input_tokens * 15.0 / 1000000) + (output_tokens * 60.0 / 1000000))::int)
WHERE agent_id = 'a0000001-0001-4000-8000-000000000004' AND cost_cents = 0;

-- Agent 5: Compliance Checker — low frequency, medium tokens (Gemini Flash)
INSERT INTO cost_records (trace_id, agent_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name, recorded_at)
SELECT
    gen_random_uuid(),
    'a0000001-0001-4000-8000-000000000005',
    (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1),
    (10000 + (random() * 30000)::int),  -- input: 10K-40K (full documents)
    (1000 + (random() * 3000)::int),    -- output: 1K-4K (short verdicts)
    0, 0,
    'gemini-2.5-flash',
    NOW() - (gs * INTERVAL '12 hours') + (random() * INTERVAL '8 hours')
FROM generate_series(0, 59) gs;  -- ~60 requests over 30 days (2/day)

UPDATE cost_records SET
    total_tokens = input_tokens + output_tokens,
    cost_cents = GREATEST(1, ((input_tokens * 15.0 / 1000000) + (output_tokens * 60.0 / 1000000))::int)
WHERE agent_id = 'a0000001-0001-4000-8000-000000000005' AND cost_cents = 0;


-- ────────────────────────────────
-- 4. BUDGET HISTORY (Archived periods)
-- ────────────────────────────────
-- Simulates 3 past budget periods that have already reset.

-- Get budget IDs for history entries (use the names we just created)
INSERT INTO budget_history (budget_id, budget_name, scope_type, scope_id, period, period_start, period_end, final_tokens, final_cost_cents, token_limit, cost_limit_cents)
SELECT id, 'ML Engineering Monthly', 'team', 'ml-engineering', 'monthly',
    NOW() - INTERVAL '78 days', NOW() - INTERVAL '48 days',
    42000000, 210000, 50000000, 250000
FROM budgets WHERE name = 'ML Engineering Monthly' LIMIT 1;

INSERT INTO budget_history (budget_id, budget_name, scope_type, scope_id, period, period_start, period_end, final_tokens, final_cost_cents, token_limit, cost_limit_cents)
SELECT id, 'ML Engineering Monthly', 'team', 'ml-engineering', 'monthly',
    NOW() - INTERVAL '48 days', NOW() - INTERVAL '18 days',
    48500000, 242500, 50000000, 250000
FROM budgets WHERE name = 'ML Engineering Monthly' LIMIT 1;

INSERT INTO budget_history (budget_id, budget_name, scope_type, scope_id, period, period_start, period_end, final_tokens, final_cost_cents, token_limit, cost_limit_cents)
SELECT id, 'Engineering Quarterly', 'department', 'engineering', 'quarterly',
    NOW() - INTERVAL '130 days', NOW() - INTERVAL '40 days',
    175000000, 875000, 200000000, 1000000
FROM budgets WHERE name = 'Engineering Quarterly' LIMIT 1;


-- ────────────────────────────────
-- VERIFICATION QUERIES (optional — run to confirm)
-- ────────────────────────────────
-- SELECT 'agents' as entity, count(*) FROM agents;
-- SELECT 'budgets' as entity, count(*) FROM budgets;
-- SELECT 'cost_records' as entity, count(*) FROM cost_records;
-- SELECT 'budget_history' as entity, count(*) FROM budget_history;
-- SELECT agent_id, count(*), sum(total_tokens) as total_tokens, sum(cost_cents) as total_cost FROM cost_records GROUP BY agent_id;
-- SELECT name, scope_type, current_tokens, token_limit, round(current_tokens::numeric / NULLIF(token_limit,0) * 100, 1) as pct FROM budgets;
