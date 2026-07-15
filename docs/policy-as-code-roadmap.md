# AI Sure — Policy-as-Code & Open Standards Roadmap

> **Version**: 1.0  
> **Date**: July 2026  
> **Audience**: Engineering, Product, Compliance Teams

---

## Executive Summary

AI Sure currently uses a **proprietary format** for access policies, compliance rules, and guardrails. While functional, this creates vendor lock-in and limits interoperability with enterprise compliance toolchains.

This document outlines a phased roadmap to adopt **open standards** — enabling enterprises to import their existing compliance catalogs, policy definitions, and guardrail specifications in industry-standard formats.

---

## 1. Current State Assessment

### What We Have Today

| Component | Current Format | Storage | How It Works |
|-----------|---------------|---------|--------------|
| **Access Policies** | Custom JSON (`rules_json`) | PostgreSQL `policies` table | ABAC-style: subjects (role, email, dept) × resources (agent, workflow) → allow/deny |
| **Compliance Rules** | Hardcoded JS objects | `compliance/service.js` + DB fallback (`compliance_rules` table) | 5 rules per framework (SOX, HIPAA, GDPR, PCI-DSS) with id, name, description, severity |
| **Compliance Checks** | JavaScript logic | `ComplianceService.runComplianceCheck()` | Regex-based PII detection + rule evaluation + optional live agent invocation |
| **Guardrails** | Regex patterns | PostgreSQL `guardrail_rules` table | Input/output regex matching for PII, SSN, credit cards, custom patterns |

### Example: Current Policy Format (Proprietary)

```json
{
  "name": "Deny Viewer Access to Finance Agents",
  "policy_type": "access_control",
  "rules_json": {
    "effect": "deny",
    "subjects": [
      { "field": "role", "operator": "equals", "value": "viewer" }
    ],
    "resources": [
      { "field": "slug", "operator": "equals", "value": "finance-agent" }
    ]
  }
}
```

### Example: Current Compliance Rule (Proprietary)

```javascript
{
  id: 'sox-1',
  name: 'Financial Data Integrity',
  description: 'Ensure agent output does not fabricate or alter financial figures',
  category: 'data_integrity',
  severity: 'critical'
}
```

### Limitations

- **No import/export**: Enterprises can't bring their existing compliance catalogs
- **No policy versioning**: No Git-friendly format for policy-as-code workflows
- **No interoperability**: Can't share policies between AI Sure and other governance tools (OPA, HashiCorp Sentinel, etc.)
- **Hardcoded validation**: Compliance check logic is JavaScript, not declarative rules
- **No attestation**: No standard way to prove compliance to auditors beyond our own reports

---

## 2. Open Standards Landscape

### Policy-as-Code Standards

| Standard | Maintained By | Format | Best For | Maturity |
|----------|--------------|--------|----------|----------|
| **OPA / Rego** | Styra / CNCF | `.rego` files | Authorization, access control | 🟢 Production-ready |
| **Cedar** | AWS | Cedar language | Fine-grained permissions | 🟡 Growing adoption |
| **HashiCorp Sentinel** | HashiCorp | Sentinel language | Infrastructure policies | 🟢 Production (proprietary) |
| **XACML** | OASIS | XML/JSON | Enterprise ABAC | 🟢 Mature (complex) |

### Compliance Framework Standards

| Standard | Maintained By | Format | Best For | Maturity |
|----------|--------------|--------|----------|----------|
| **OSCAL** | NIST | JSON / XML / YAML | Compliance catalogs (SOX, HIPAA, FedRAMP) | 🟡 Growing (US Gov) |
| **CIS Benchmarks** | CIS | XCCDF / OVAL | Infrastructure hardening | 🟢 Mature |
| **STIX/TAXII** | OASIS | JSON | Threat intelligence sharing | 🟢 Mature |
| **OpenControl** | GovReady | YAML | Compliance-as-code for ATO | 🟡 Niche |

### AI-Specific Standards

| Standard | Maintained By | Format | Best For | Maturity |
|----------|--------------|--------|----------|----------|
| **NIST AI RMF** | NIST | Framework doc | AI risk management | 🟡 Framework only |
| **EU AI Act** | European Commission | Legal text | AI classification & requirements | 🟡 Being codified |
| **NeMo Guardrails** | NVIDIA | YAML (Colang) | AI guardrail definitions | 🟡 Emerging |
| **MLCommons AI Safety** | MLCommons | Benchmark suite | AI safety evaluation | 🔴 Early |

---

## 3. Recommended Adoption Roadmap

### Phase 1: OPA/Rego for Access Policies (Highest Impact)

**Why OPA?**
- CNCF graduated project — industry standard for policy-as-code
- Used by Kubernetes, Envoy, Terraform, Kafka, and hundreds of enterprises
- Declarative language (Rego) that's auditable and versionable
- Supports policy bundles — download from Git, S3, or HTTP
- Built-in testing framework

**What Changes**

| Before (Current) | After (OPA) |
|-------------------|-------------|
| Custom `rules_json` in PostgreSQL | `.rego` files in Git + OPA bundle server |
| `PolicyService._evaluatePolicy()` in JS | OPA REST API: `POST /v1/data/aisure/authz` |
| Dashboard-only policy management | Dashboard + Git-based policy-as-code |
| No policy testing | `opa test` CLI + policy unit tests |

**Example: Same Policy in Rego**

```rego
# policies/access_control.rego
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

# Allow if no deny rules matched and at least one allow matched
allow if {
    not deny
    some policy in data.policies
    policy.effect == "allow"
    matches_subject(policy, input.user)
    matches_resource(policy, input.agent)
}

matches_subject(policy, user) if {
    every cond in policy.subjects {
        eval_condition(cond, user)
    }
}

matches_resource(policy, agent) if {
    every cond in policy.resources {
        eval_condition(cond, agent)
    }
}

eval_condition(cond, obj) if {
    cond.operator == "equals"
    obj[cond.field] == cond.value
}

eval_condition(cond, obj) if {
    cond.operator == "in"
    obj[cond.field] == cond.value[_]
}
```

**Integration Architecture**

```
┌──────────────────────────────────────────┐
│  AI Sure Gateway                         │
│                                          │
│  1. Build OPA input from request context │
│  2. POST to OPA sidecar                  │
│  3. Read decision (allow/deny)           │
│  4. Audit log the decision               │
└─────────────┬────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│  OPA Sidecar / Embedded                  │
│                                          │
│  Evaluates .rego policies                │
│  Loads bundles from Git/S3/HTTP          │
│  Decision: { "allow": true/false }       │
└──────────────────────────────────────────┘
              ▲
              │ Policy bundles
┌──────────────────────────────────────────┐
│  Git Repository                          │
│                                          │
│  policies/                               │
│    access_control.rego                   │
│    compliance_gates.rego                 │
│    guardrail_rules.rego                  │
│  policies_test/                          │
│    access_control_test.rego              │
│  data.json  (static data)               │
└──────────────────────────────────────────┘
```

**Implementation Estimate**: 2-3 weeks

---

### Phase 2: OSCAL for Compliance Frameworks (Regulatory Ready)

**Why OSCAL?**

OSCAL (Open Security Controls Assessment Language) is a NIST standard that provides machine-readable formats for:
- **Catalogs**: The full set of controls in a framework (e.g., all 300+ NIST 800-53 controls)
- **Profiles**: A selection of controls for a specific use case (e.g., "SOX-relevant subset")
- **Component Definitions**: How your system implements each control
- **Assessment Plans**: How to test compliance
- **Assessment Results**: The actual findings

NIST already publishes official OSCAL catalogs for NIST 800-53, FedRAMP, and others. Community catalogs exist for SOX, HIPAA, and PCI-DSS.

**What Changes**

| Before (Current) | After (OSCAL) |
|-------------------|---------------|
| 5 hardcoded rules per framework | Import full OSCAL catalog (100+ controls) |
| `getFrameworkRules()` returns JS objects | Parse OSCAL JSON catalog → control list |
| No control mapping | Map AI Sure features → OSCAL control IDs |
| Proprietary report format | OSCAL Assessment Results (machine-readable) |

**Example: OSCAL Catalog (SOX Control)**

```json
{
  "catalog": {
    "uuid": "a]f3e-...",
    "metadata": {
      "title": "SOX Compliance Controls for AI Agents",
      "version": "1.0.0"
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
              { "name": "severity", "value": "critical" },
              { "name": "category", "value": "data_integrity" }
            ],
            "parts": [
              {
                "name": "statement",
                "prose": "AI agents processing financial data MUST NOT fabricate, hallucinate, or alter financial figures. All numerical outputs must be traceable to source data."
              },
              {
                "name": "guidance",
                "prose": "Implement output validation that cross-references agent responses against source documents. Flag any financial figures that cannot be traced to input data."
              }
            ],
            "controls": [
              {
                "id": "SOX-AI-DI-01.a",
                "title": "Output Validation",
                "parts": [
                  {
                    "name": "statement",
                    "prose": "Agent outputs containing financial figures MUST include source attribution."
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**Example: OSCAL Assessment Result**

```json
{
  "assessment-results": {
    "uuid": "b2c4...",
    "metadata": {
      "title": "AI Sure Compliance Assessment — SOX Q3 2026"
    },
    "results": [
      {
        "uuid": "r1...",
        "title": "SOX Automated Check — Corp Chatbot",
        "start": "2026-07-14T10:00:00Z",
        "end": "2026-07-14T10:05:00Z",
        "findings": [
          {
            "uuid": "f1...",
            "title": "Financial Data Integrity Check",
            "target": {
              "type": "component",
              "target-id": "corpgcpmcp",
              "status": { "state": "satisfied" }
            },
            "related-observations": ["obs-1"]
          }
        ],
        "observations": [
          {
            "uuid": "obs-1",
            "description": "Agent correctly referenced source documents for all financial figures. No hallucinated numbers detected.",
            "methods": ["TEST"],
            "collected": "2026-07-14T10:03:00Z"
          }
        ]
      }
    ]
  }
}
```

**Upload Flow for Enterprises**

```
Enterprise Compliance Team
    │
    │  Uploads OSCAL catalog JSON
    ▼
┌────────────────────────────────────┐
│  AI Sure Dashboard                 │
│  Compliance → Import Framework     │
│                                    │
│  1. Parse OSCAL catalog            │
│  2. Extract controls + severity    │
│  3. Map to AI Sure rule format     │
│  4. Store in compliance_rules DB   │
│  5. Ready for automated checks     │
└────────────────────────────────────┘
    │
    │  Run compliance check
    ▼
┌────────────────────────────────────┐
│  AI Sure Compliance Engine         │
│                                    │
│  1. Load OSCAL-sourced rules       │
│  2. Generate test samples          │
│  3. Invoke agent (optional)        │
│  4. Evaluate against controls      │
│  5. Export OSCAL Assessment Result │
└────────────────────────────────────┘
```

**Implementation Estimate**: 3-4 weeks

---

### Phase 3: Guardrail Definition Standard (Forward-Looking)

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
    
    - id: pii-email
      name: Email Address
      severity: medium
      pattern: '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
      action: flag
      message: "Email address detected — flagged for review"
    
    - id: prompt-injection
      name: Prompt Injection Attempt
      severity: critical
      pattern: '(?i)(ignore previous|ignore all|disregard|forget your|system prompt)'
      action: block
      message: "Potential prompt injection detected"

  exceptions:
    - agent: internal-hr-bot
      skip_rules: [pii-email]
      reason: "HR bot needs to process employee emails"
```

**Implementation Estimate**: 2 weeks

---

## 4. Migration Strategy

### Backward Compatibility

All phases maintain backward compatibility — existing dashboard-configured policies continue to work.

```
┌─────────────────────────────────────────────────┐
│  AI Sure Policy Evaluation                       │
│                                                   │
│  Input: request context                           │
│                                                   │
│  ┌─────────────┐  ┌──────────────┐               │
│  │ Dashboard    │  │ Policy-as-   │               │
│  │ Policies     │  │ Code (OPA)   │               │
│  │ (DB-stored)  │  │ (.rego files)│               │
│  └──────┬──────┘  └──────┬───────┘               │
│         │                │                        │
│         ▼                ▼                        │
│  ┌────────────────────────────┐                   │
│  │  Unified Policy Evaluator  │                   │
│  │  (merge results)           │                   │
│  └────────────┬───────────────┘                   │
│               │                                   │
│               ▼                                   │
│  Decision: allow / deny + reason                  │
└─────────────────────────────────────────────────┘
```

### Dual-Mode Operation

During migration, the system supports both modes:

| Mode | Source | Evaluated By | For Who |
|------|--------|-------------|---------|
| **Dashboard Mode** (current) | PostgreSQL `policies` table | `PolicyService.evaluate()` | Teams using the UI |
| **Code Mode** (new) | `.rego` files in Git/S3 | OPA sidecar | Teams with policy-as-code workflows |
| **Hybrid** | Both | Merged (deny wins) | Transition period |

---

## 5. Implementation Priority Matrix

| Phase | Standard | Impact | Effort | Priority |
|-------|----------|--------|--------|----------|
| **Phase 1** | OPA/Rego (policies) | 🔴 High — enables policy-as-code | 2-3 weeks | **P0** |
| **Phase 2** | OSCAL (compliance) | 🔴 High — regulatory credibility | 3-4 weeks | **P0** |
| **Phase 3** | YAML guardrails | 🟡 Medium — versionable guardrails | 2 weeks | **P1** |
| **Phase 4** | OSCAL export (reports) | 🟡 Medium — auditor interop | 2 weeks | **P1** |
| **Phase 5** | Cedar support (alt.) | 🟢 Low — AWS ecosystem only | 2 weeks | **P2** |

---

## 6. Key Benefits of Adoption

### For Enterprises

| Benefit | Without Standards | With Standards |
|---------|-------------------|----------------|
| **Onboarding** | Manually recreate all policies in dashboard | Import existing OPA policies from Git |
| **Compliance** | Trust AI Sure's proprietary rules | Import NIST/OSCAL catalogs — auditor-recognized |
| **Audit** | Proprietary reports | OSCAL Assessment Results — machine-readable, shareable |
| **CI/CD** | Dashboard-only changes | `git push` → policy deployed → tests pass |
| **Multi-tool** | Policies locked in AI Sure | Same .rego files used across Kubernetes, Envoy, AI Sure |

### For AI Sure (Product)

| Benefit | Impact |
|---------|--------|
| **Enterprise sales** | "We support OPA and OSCAL" removes a common objection |
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
