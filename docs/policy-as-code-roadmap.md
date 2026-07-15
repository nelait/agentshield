# AI Sure — Policy-as-Code & Open Standards Roadmap

> **Version**: 2.0 (Updated)  
> **Date**: July 2026  
> **Audience**: Engineering, Product, Compliance Teams  
> **Status**: Phase 1 ✅ IMPLEMENTED | Phase 2 ✅ IMPLEMENTED | Phase 3 📋 Planned

---

## Executive Summary

AI Sure has adopted **open standards** for policy enforcement and compliance validation, replacing proprietary formats with industry-standard tooling. This enables enterprises to import existing compliance catalogs, author policies as code, and generate machine-readable audit artifacts.

| Phase | Standard | Status | Release |
|-------|----------|--------|---------|
| **Phase 1** | OPA / Rego | ✅ Implemented | July 2026 |
| **Phase 2** | NIST OSCAL | ✅ Implemented | July 2026 |
| **Phase 3** | YAML Guardrails | 📋 Planned | TBD |

---

## 1. Current State (Post Phase 1 + Phase 2)

### What We Have Today

| Component | Format | Storage | How It Works |
|-----------|--------|---------|--------------|
| **Access Policies** | Custom JSON + OPA Rego (dual-mode) | PostgreSQL `policies` table + `.rego` files | ABAC-style rules with optional OPA/Rego compilation and WASM evaluation |
| **Compliance Rules** | Built-in JS + OSCAL catalog imports | `compliance_rules` table + `oscal_catalogs` table | 5 built-in rules per framework + unlimited OSCAL-imported controls |
| **Compliance Checks** | JavaScript logic + OSCAL export | `ComplianceService.runComplianceCheck()` | Regex-based PII detection + rule evaluation + OSCAL Assessment Result export |
| **Guardrails** | Regex patterns | PostgreSQL `guardrail_rules` table | Input/output regex matching for PII, SSN, credit cards, custom patterns |

---

## 2. Phase 1: OPA/Rego for Access Policies ✅ IMPLEMENTED

### Implementation Summary

OPA (Open Policy Agent) Rego has been integrated as a **dual-mode policy engine** alongside the existing dashboard-configured JSON policies. Policies authored in the dashboard UI are compiled to Rego and can be evaluated via OPA's WASM runtime.

### What Was Delivered

| Component | File | Description |
|-----------|------|-------------|
| **Rego Evaluator** | `src/policies/rego-evaluator.js` | OPA WASM-based Rego policy evaluation engine |
| **Policy Service** | `src/policies/service.js` | Updated with dual-mode evaluation (JSON + Rego) |
| **Rego Export API** | `GET /policies/:id/rego` | Export any policy as a `.rego` file |
| **Dashboard Editor** | `Compliance.jsx` (Rules tab) | Rego code editor with syntax highlighting |
| **Docker Integration** | `Dockerfile` | OPA binary included in container image |

### Dual-Mode Evaluation

```
┌─────────────────────────────────────────────────┐
│  AI Sure Policy Evaluation (Dual-Mode)           │
│                                                   │
│  Input: request context (user, agent, workflow)   │
│                                                   │
│  ┌─────────────┐  ┌──────────────┐               │
│  │ Dashboard    │  │ OPA/Rego     │               │
│  │ Policies     │  │ Compiled     │               │
│  │ (JSON rules) │  │ (.rego WASM) │               │
│  └──────┬──────┘  └──────┬───────┘               │
│         │                │                        │
│         ▼                ▼                        │
│  ┌────────────────────────────┐                   │
│  │  Unified Policy Evaluator  │                   │
│  │  (merge results, deny wins)│                   │
│  └────────────┬───────────────┘                   │
│               │                                   │
│               ▼                                   │
│  Decision: allow / deny + reason                  │
└─────────────────────────────────────────────────┘
```

### API Endpoints (Phase 1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/policies/:id/rego` | Export policy as Rego format |

### Rego Example

```rego
package aisure.authz

import rego.v1

default allow := false

# Deny viewers from accessing finance agents
deny if {
    input.user.role == "viewer"
    input.agent.slug == "finance-agent"
}

# Allow admins everywhere
allow if {
    input.user.role == "admin"
}
```

### Key Design Decisions

- **Backward compatible**: All existing JSON policies continue to work without modification
- **WASM evaluation**: OPA policies are compiled to WASM for in-process evaluation (no sidecar needed)
- **Audit trail**: All policy decisions are logged regardless of evaluation mode
- **Dashboard first**: Rego is auto-generated from the visual policy editor — no CLI required

---

## 3. Phase 2: OSCAL for Compliance Frameworks ✅ IMPLEMENTED

### Implementation Summary

NIST OSCAL (Open Security Controls Assessment Language) has been integrated for **importing compliance catalogs** and **exporting assessment results**. Enterprises can now upload OSCAL-formatted control catalogs (SOX, HIPAA, NIST 800-53, FedRAMP, etc.) and receive machine-readable compliance reports.

### What Was Delivered

| Component | File | Description |
|-----------|------|-------------|
| **OSCAL Parser** | `src/compliance/oscal-parser.js` | Validates, parses OSCAL catalogs, generates Assessment Results |
| **DB Migration** | `migrations/015_oscal_catalogs.sql` | `oscal_catalogs` table + provenance columns on `compliance_rules` |
| **Compliance Service** | `src/compliance/service.js` | 6 new OSCAL methods: import, list, delete, validate, preview, export |
| **API Routes** | `src/admin/routes.js` | 6 new OSCAL endpoints |
| **Dashboard UI** | `Compliance.jsx` | Import modal, catalog list, OSCAL badges, export button |
| **Dashboard API** | `api.js` | 6 new OSCAL API methods |

### API Endpoints (Phase 2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/compliance/oscal/validate` | Validate OSCAL JSON structure |
| `POST` | `/compliance/oscal/preview` | Parse catalog without saving (preview groups/controls) |
| `POST` | `/compliance/oscal/import` | Import catalog → compliance rules |
| `GET` | `/compliance/oscal/catalogs` | List imported OSCAL catalogs |
| `DELETE` | `/compliance/oscal/catalogs/:id` | Delete catalog + associated rules (CASCADE) |
| `GET` | `/compliance/checks/:id/oscal` | Export compliance check as OSCAL Assessment Result |

### OSCAL Import Flow

```
Enterprise Compliance Team
    │
    │  Uploads OSCAL catalog JSON (file or paste)
    ▼
┌────────────────────────────────────────┐
│  AI Sure Dashboard                     │
│  Compliance → Rules → Import OSCAL     │
│                                        │
│  1. Validate OSCAL JSON structure      │
│  2. Preview: show groups + controls    │
│  3. User selects groups to import      │
│  4. Parse controls → compliance_rules  │
│  5. Store catalog in oscal_catalogs    │
│  6. Rules appear with "OSCAL" badge    │
└────────────────────────────────────────┘
    │
    │  Run compliance check
    ▼
┌────────────────────────────────────────┐
│  AI Sure Compliance Engine             │
│                                        │
│  1. Load built-in + OSCAL rules        │
│  2. Generate test samples              │
│  3. Invoke agent (optional)            │
│  4. Evaluate against all controls      │
│  5. Export OSCAL Assessment Result     │
└────────────────────────────────────────┘
```

### OSCAL Catalog Example (Import)

```json
{
  "catalog": {
    "uuid": "a3f3e2c1-sox-ai-catalog-2026",
    "metadata": {
      "title": "SOX Compliance Controls for AI Agents",
      "version": "2.0.0",
      "oscal-version": "1.1.2"
    },
    "groups": [
      {
        "id": "sox-data-integrity",
        "title": "Data Integrity Controls",
        "controls": [
          {
            "id": "SOX-AI-DI-01",
            "title": "Financial Data Integrity",
            "props": [
              { "name": "severity", "value": "critical" }
            ],
            "parts": [
              {
                "name": "statement",
                "prose": "AI agents MUST NOT fabricate financial figures."
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### OSCAL Assessment Result Example (Export)

```json
{
  "assessment-results": {
    "uuid": "b2c4e5f6-...",
    "metadata": {
      "title": "AI Sure Compliance Assessment — SOX Jul 2026",
      "oscal-version": "1.1.2"
    },
    "results": [{
      "title": "SOX Automated Check — Corp Chatbot",
      "start": "2026-07-14T10:00:00Z",
      "end": "2026-07-14T10:05:00Z",
      "props": [
        { "name": "total-rules", "value": "13" },
        { "name": "passed-rules", "value": "12" },
        { "name": "failed-rules", "value": "1" }
      ],
      "findings": [
        {
          "title": "Financial Data Integrity Check",
          "target": {
            "type": "objective-id",
            "target-id": "SOX-AI-DI-01",
            "status": { "state": "satisfied" }
          }
        }
      ]
    }]
  }
}
```

### Database Schema (Phase 2)

| Table | Description |
|-------|-------------|
| `oscal_catalogs` | Imported OSCAL catalog metadata + source JSON |
| `compliance_rules` (updated) | New columns: `oscal_catalog_id`, `oscal_control_id`, `oscal_statement`, `oscal_guidance` |

### Dashboard UI Features

| Feature | Location | Description |
|---------|----------|-------------|
| **Import OSCAL** button | Compliance → Rules tab header | Opens import modal |
| **Import Modal** | Modal overlay | JSON paste/file upload, framework picker, group selector |
| **OSCAL Badge** | Rules list → Type column | Purple "OSCAL" badge vs blue "Built-in" / green "Custom" |
| **Imported Catalogs** | Below rules table | Lists all imported catalogs with delete option |
| **Export OSCAL** button | History → Check detail | Downloads assessment result as OSCAL JSON |

### Key Design Decisions

- **Selective import**: Users pick which control groups to import (full catalogs can be 300+ controls)
- **Non-destructive**: Imported rules coexist with built-in rules; deleting a catalog cascades to its rules only
- **OSCAL 1.1.2 compliance**: Parser supports the latest OSCAL spec including nested groups and sub-controls
- **Keyword-based evaluation**: OSCAL controls are matched using extracted keywords from control statements
- **Provenance tracking**: Every imported rule links back to its source catalog via `oscal_catalog_id`

---

## 4. Phase 3: Guardrail Definition Standard (Planned)

**Status**: 📋 Planned

**Current Landscape**: There is no widely-adopted open standard for AI guardrails yet. The closest options:

| Option | Format | Pros | Cons |
|--------|--------|------|------|
| **NeMo Guardrails (Colang)** | YAML + Colang | NVIDIA backing, active development | Proprietary language, NVIDIA ecosystem |
| **Custom YAML schema** | YAML | Simple, human-readable, versionable | Not a standard — would be AI Sure-specific |
| **OPA/Rego extension** | `.rego` | Reuses Phase 1 infrastructure | Rego not ideal for content filtering |
| **OWASP LLM Top 10** | Checklist | Well-known, comprehensive | Not machine-readable |

**Recommended Approach**: Define a **YAML-based guardrail format** that is human-readable and Git-friendly, with the flexibility to adopt an emerging standard when one matures.

**Example: Guardrail YAML Format**

```yaml
# guardrails/pii-protection.yaml
guardrail:
  name: PII Protection Profile
  version: "1.0"
  description: Block PII in agent inputs and outputs
  scope: [input, output]
  
  rules:
    - id: pii-ssn
      name: Social Security Number
      severity: critical
      pattern: '\b\d{3}-\d{2}-\d{4}\b'
      action: block
      message: "SSN detected — request blocked"
    
    - id: pii-credit-card
      name: Credit Card Number
      severity: critical
      pattern: '\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b'
      action: block
      message: "Credit card number detected — request blocked"

  exceptions:
    - agent: internal-hr-bot
      skip_rules: [pii-email]
      reason: "HR bot needs to process employee emails"
```

**Implementation Estimate**: 2 weeks

---

## 5. Implementation Priority Matrix

| Phase | Standard | Impact | Status |
|-------|----------|--------|--------|
| **Phase 1** | OPA/Rego (policies) | 🔴 High — enables policy-as-code | ✅ Implemented |
| **Phase 2** | OSCAL (compliance) | 🔴 High — regulatory credibility | ✅ Implemented |
| **Phase 3** | YAML guardrails | 🟡 Medium — versionable guardrails | 📋 Planned |
| **Phase 4** | Cedar support (alt.) | 🟢 Low — AWS ecosystem only | 📋 Planned |

---

## 6. Key Benefits Achieved

### For Enterprises

| Benefit | Before (Pre-Phase 1/2) | After (Current) |
|---------|------------------------|------------------|
| **Policy Authoring** | Dashboard-only JSON rules | Dashboard + OPA Rego + Git-based policy-as-code |
| **Compliance Catalogs** | 5 hardcoded rules per framework | Import full OSCAL catalogs (100+ controls per framework) |
| **Audit Reports** | Proprietary report format | OSCAL Assessment Results (machine-readable, shareable) |
| **Standards Compliance** | Proprietary formats only | OPA (CNCF), OSCAL (NIST) — auditor-recognized |
| **Interoperability** | Policies locked in AI Sure | Same .rego files usable across Kubernetes, Envoy, Terraform |

### For AI Sure (Product)

| Benefit | Impact |
|---------|--------|
| **Enterprise sales** | "We support OPA and OSCAL" removes common objections |
| **Compliance credibility** | NIST OSCAL adoption signals regulatory seriousness |
| **Ecosystem** | Integrates with existing enterprise governance toolchains |
| **Differentiation** | No competitor in the AI governance space supports OSCAL today |

---

## 7. References

| Resource | URL |
|----------|-----|
| OPA Documentation | https://www.openpolicyagent.org/docs/ |
| Rego Language Reference | https://www.openpolicyagent.org/docs/latest/policy-language/ |
| NIST OSCAL | https://pages.nist.gov/OSCAL/ |
| OSCAL Catalog Model | https://pages.nist.gov/OSCAL/concepts/layer/control/catalog/ |
| OSCAL GitHub | https://github.com/usnistgov/OSCAL |
| Cedar Policy Language | https://www.cedarpolicy.com/ |
| NeMo Guardrails | https://github.com/NVIDIA/NeMo-Guardrails |
| OWASP LLM Top 10 | https://owasp.org/www-project-top-10-for-large-language-model-applications/ |
| NIST AI RMF | https://www.nist.gov/artificial-intelligence/ai-risk-management-framework |
