-- Migration: OSCAL compliance catalog support
-- New table for imported OSCAL catalogs + extensions to compliance_rules

-- Track imported OSCAL catalog sources
CREATE TABLE IF NOT EXISTS oscal_catalogs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_uuid      VARCHAR(255) NOT NULL,
    title             VARCHAR(512) NOT NULL,
    version           VARCHAR(50),
    framework         VARCHAR(30) CHECK (framework IN ('sox', 'hipaa', 'gdpr', 'pci_dss', 'custom', 'nist_800_53', 'fedramp')),
    source_json       JSONB NOT NULL,
    total_controls    INT DEFAULT 0,
    imported_controls INT DEFAULT 0,
    imported_by       UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oscal_catalogs_framework ON oscal_catalogs(framework);

-- Extend compliance_rules with OSCAL provenance columns
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS oscal_catalog_id UUID REFERENCES oscal_catalogs(id) ON DELETE CASCADE;
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS oscal_control_id VARCHAR(100);
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS oscal_statement  TEXT;
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS oscal_guidance   TEXT;

-- Relax the framework CHECK constraint to allow additional framework values
-- (needed for nist_800_53, fedramp, etc.)
ALTER TABLE compliance_rules DROP CONSTRAINT IF EXISTS compliance_rules_framework_check;
ALTER TABLE compliance_rules ADD CONSTRAINT compliance_rules_framework_check
    CHECK (framework IN ('sox', 'hipaa', 'gdpr', 'pci_dss', 'custom', 'nist_800_53', 'fedramp'));
