-- ============================================
-- AgentShield Settings & Compliance Rules
-- Migration: 003_settings_and_rules.sql
-- ============================================

-- ============================================
-- SETTINGS (key-value store for connections, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category        VARCHAR(50) NOT NULL,       -- 'llm', 'general', 'notifications'
    key             VARCHAR(255) NOT NULL,
    value           JSONB DEFAULT '{}',
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(category, key)
);

-- ============================================
-- COMPLIANCE RULES (editable, per-framework)
-- ============================================
CREATE TABLE IF NOT EXISTS compliance_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    framework       VARCHAR(30) NOT NULL CHECK (framework IN ('sox', 'hipaa', 'gdpr', 'pci_dss', 'custom')),
    rule_id         VARCHAR(50) NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    category        VARCHAR(100),
    severity        VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    is_enabled      BOOLEAN DEFAULT true,
    is_builtin      BOOLEAN DEFAULT true,       -- false for user-added rules
    evaluation_config JSONB DEFAULT '{}',       -- custom regex patterns, thresholds, etc.
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SEED DEFAULT COMPLIANCE RULES
-- ============================================

-- SOX Rules
INSERT INTO compliance_rules (framework, rule_id, name, description, category, severity, is_builtin) VALUES
('sox', 'sox-1', 'Financial Data Integrity', 'Ensure agent output does not fabricate or alter financial figures', 'data_integrity', 'critical', true),
('sox', 'sox-2', 'Segregation of Duties', 'Verify agent does not bypass multi-level approval requirements', 'access_control', 'critical', true),
('sox', 'sox-3', 'Access Logging Completeness', 'Confirm all agent interactions are fully logged in audit trail', 'audit', 'high', true),
('sox', 'sox-4', 'PII in Financial Data', 'Detect personal identifiers in financial processing output', 'data_protection', 'high', true),
('sox', 'sox-5', 'Approval Trail Verification', 'Ensure modification actions reference valid approvals', 'governance', 'medium', true)
ON CONFLICT (rule_id) DO NOTHING;

-- HIPAA Rules
INSERT INTO compliance_rules (framework, rule_id, name, description, category, severity, is_builtin) VALUES
('hipaa', 'hipaa-1', 'PHI Detection', 'Detect Protected Health Information in agent I/O', 'phi_protection', 'critical', true),
('hipaa', 'hipaa-2', 'Encryption Adequacy', 'Verify data is encrypted at rest and in transit', 'encryption', 'critical', true),
('hipaa', 'hipaa-3', 'Access Control Verification', 'Confirm RBAC enforces minimum necessary access', 'access_control', 'high', true),
('hipaa', 'hipaa-4', 'Minimum Necessary Rule', 'Ensure agent receives only minimum data needed', 'data_minimization', 'high', true),
('hipaa', 'hipaa-5', 'Data Retention Compliance', 'Validate retention meets HIPAA 6-year requirement', 'retention', 'medium', true)
ON CONFLICT (rule_id) DO NOTHING;

-- GDPR Rules
INSERT INTO compliance_rules (framework, rule_id, name, description, category, severity, is_builtin) VALUES
('gdpr', 'gdpr-1', 'PII Detection', 'Detect personal data in agent I/O (EU residents)', 'pii_protection', 'critical', true),
('gdpr', 'gdpr-2', 'Consent Tracking', 'Verify data processing has associated consent records', 'consent', 'critical', true),
('gdpr', 'gdpr-3', 'Right to Erasure Support', 'Check if agent data can be purged on request', 'data_rights', 'high', true),
('gdpr', 'gdpr-4', 'Data Minimization', 'Ensure only necessary data is processed', 'data_minimization', 'high', true),
('gdpr', 'gdpr-5', 'Cross-Border Transfer Check', 'Flag data transfers outside EU/EEA', 'transfer', 'medium', true)
ON CONFLICT (rule_id) DO NOTHING;

-- PCI-DSS Rules
INSERT INTO compliance_rules (framework, rule_id, name, description, category, severity, is_builtin) VALUES
('pci_dss', 'pci-1', 'Credit Card Data Detection', 'Detect credit card numbers in agent I/O', 'card_data', 'critical', true),
('pci_dss', 'pci-2', 'Encryption Standards', 'Verify data uses PCI-compliant encryption (AES-256)', 'encryption', 'critical', true),
('pci_dss', 'pci-3', 'Access Control', 'Verify restricted access to cardholder data', 'access_control', 'high', true),
('pci_dss', 'pci-4', 'Audit Trail Completeness', 'Ensure all card data access is logged', 'audit', 'high', true),
('pci_dss', 'pci-5', 'Network Segmentation', 'Validate agent endpoint is in isolated network segment', 'network', 'medium', true)
ON CONFLICT (rule_id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
CREATE INDEX IF NOT EXISTS idx_compliance_rules_framework ON compliance_rules(framework);
CREATE INDEX IF NOT EXISTS idx_compliance_rules_enabled ON compliance_rules(is_enabled);
