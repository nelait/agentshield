#!/bin/bash
# ============================================
# AI Sure — Guardrails & Compliance Sample Data
# Populates the GCP production database with 
# comprehensive test data
# ============================================

API="https://agentshield-api-622662891364.us-central1.run.app/api/v1"
KEY="ask_39154f35acee040c11acfe4de55b9b10420bbad83a9ba9f4"
H1="Content-Type: application/json"
H2="X-API-Key: $KEY"

echo "============================================"
echo "  AI Sure — Sample Data Seeder"
echo "============================================"

# ── GET AUTH TOKEN (needed for editor/admin routes) ──
echo ""
echo "→ Authenticating..."
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "$H1" \
  -d '{"email":"admin@agentshield.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))")

if [ -z "$TOKEN" ]; then
  echo "  ✗ Failed to authenticate"
  exit 1
fi
echo "  ✓ Authenticated (super_admin)"
AUTH="Authorization: Bearer $TOKEN"

# ============================================
# GUARDRAIL PROFILES & RULES
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  GUARDRAIL PROFILES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Profile 1: PII Protection ──
echo ""
echo "→ Creating PII Protection profile..."
PII_PROFILE=$(curl -s -X POST "$API/guardrails/profiles" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "PII Protection Shield",
    "description": "Detects and blocks personally identifiable information including SSN, credit cards, phone numbers, and email addresses in agent inputs and outputs.",
    "mode": "block",
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))")

if [ -n "$PII_PROFILE" ]; then
  echo "  ✓ Profile created: $PII_PROFILE"

  # Rule 1: SSN Detection
  echo "  → Adding SSN detection rule..."
  curl -s -X POST "$API/guardrails/profiles/$PII_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "SSN Detector",
      "description": "Blocks Social Security Numbers in format XXX-XX-XXXX or XXXXXXXXX",
      "ruleType": "regex",
      "scope": "both",
      "config": {"pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b|\\b\\d{9}\\b", "message": "Social Security Number detected and blocked"},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ SSN Detector"

  # Rule 2: Credit Card Detection  
  echo "  → Adding credit card detection rule..."
  curl -s -X POST "$API/guardrails/profiles/$PII_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Credit Card Detector",
      "description": "Blocks credit card numbers (Visa, MasterCard, Amex patterns)",
      "ruleType": "regex",
      "scope": "both",
      "config": {"pattern": "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b", "message": "Credit card number detected and blocked"},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Credit Card Detector"

  # Rule 3: Email PII
  echo "  → Adding email PII detection rule..."
  curl -s -X POST "$API/guardrails/profiles/$PII_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Email Address Detector",
      "description": "Detects email addresses that may contain PII",
      "ruleType": "regex",
      "scope": "output",
      "config": {"pattern": "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b", "message": "Email address detected in output"},
      "severity": "high",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Email Address Detector"

  # Rule 4: Phone Number
  echo "  → Adding phone number detection rule..."
  curl -s -X POST "$API/guardrails/profiles/$PII_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Phone Number Detector",
      "description": "Detects US phone numbers in various formats",
      "ruleType": "regex",
      "scope": "both",
      "config": {"pattern": "\\b(?:\\+1)?[\\s.-]?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}\\b", "message": "Phone number detected"},
      "severity": "high",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Phone Number Detector"
else
  echo "  ✗ Failed to create PII profile (may already exist)"
fi

# ── Profile 2: Prompt Injection Defense ──
echo ""
echo "→ Creating Prompt Injection Defense profile..."
INJECT_PROFILE=$(curl -s -X POST "$API/guardrails/profiles" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "Prompt Injection Defense",
    "description": "Detects and blocks prompt injection attacks, jailbreak attempts, and system prompt manipulation.",
    "mode": "block",
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))")

if [ -n "$INJECT_PROFILE" ]; then
  echo "  ✓ Profile created: $INJECT_PROFILE"

  curl -s -X POST "$API/guardrails/profiles/$INJECT_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "System Prompt Override",
      "description": "Blocks attempts to override or ignore system instructions",
      "ruleType": "content_filter",
      "scope": "input",
      "config": {"keywords": ["ignore previous instructions", "ignore all instructions", "disregard your instructions", "forget your rules", "override system prompt", "you are now", "act as if you have no restrictions", "pretend you are"]},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ System Prompt Override Blocker"

  curl -s -X POST "$API/guardrails/profiles/$INJECT_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Jailbreak Attempt Detector",
      "description": "Detects common jailbreak patterns like DAN, role-play escapes",
      "ruleType": "content_filter",
      "scope": "input",
      "config": {"keywords": ["DAN mode", "jailbreak", "do anything now", "developer mode", "unrestricted mode", "no ethical guidelines", "bypass safety", "ignore safety"]},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Jailbreak Attempt Detector"

  curl -s -X POST "$API/guardrails/profiles/$INJECT_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Code Injection Blocker",
      "description": "Blocks attempts to execute system commands or code injection",
      "ruleType": "content_filter",
      "scope": "input",
      "config": {"keywords": ["os.system", "subprocess.call", "eval(", "exec(", "import os", "__import__", "rm -rf", "DROP TABLE", "DELETE FROM"]},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Code Injection Blocker"
else
  echo "  ✗ Failed to create Injection profile"
fi

# ── Profile 3: Content Safety (Audit mode) ──
echo ""
echo "→ Creating Content Safety profile..."
SAFETY_PROFILE=$(curl -s -X POST "$API/guardrails/profiles" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "Content Safety Monitor",
    "description": "Monitors for inappropriate, toxic, or harmful content in agent outputs. Runs in audit mode — flags but does not block.",
    "mode": "audit",
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))")

if [ -n "$SAFETY_PROFILE" ]; then
  echo "  ✓ Profile created: $SAFETY_PROFILE"

  curl -s -X POST "$API/guardrails/profiles/$SAFETY_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Profanity Filter",
      "description": "Flags profanity and offensive language in outputs",
      "ruleType": "content_filter",
      "scope": "output",
      "config": {"keywords": ["damn", "hell", "crap", "stupid", "idiot", "moron"]},
      "severity": "medium",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Profanity Filter"

  curl -s -X POST "$API/guardrails/profiles/$SAFETY_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Harmful Content Detector",
      "description": "Flags harmful, violent, or dangerous content",
      "ruleType": "content_filter",
      "scope": "output",
      "config": {"keywords": ["how to hack", "how to steal", "how to kill", "make a bomb", "create malware", "phishing attack"]},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Harmful Content Detector"

  curl -s -X POST "$API/guardrails/profiles/$SAFETY_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Medical/Legal Disclaimer",
      "description": "Flags when agent gives medical or legal advice without disclaimers",
      "ruleType": "content_filter",
      "scope": "output",
      "config": {"keywords": ["I am a doctor", "take this medication", "you should sue", "file a lawsuit", "this is legal advice", "this is medical advice"]},
      "severity": "high",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Medical/Legal Disclaimer"
else
  echo "  ✗ Failed to create Safety profile"
fi

# ── Profile 4: Financial Data Guard ──
echo ""
echo "→ Creating Financial Data Guard profile..."
FIN_PROFILE=$(curl -s -X POST "$API/guardrails/profiles" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "Financial Data Guard",
    "description": "Protects financial data including account numbers, routing numbers, and prevents unauthorized financial advice.",
    "mode": "block",
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))")

if [ -n "$FIN_PROFILE" ]; then
  echo "  ✓ Profile created: $FIN_PROFILE"

  curl -s -X POST "$API/guardrails/profiles/$FIN_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Bank Account Number Detector",
      "description": "Detects bank account and routing numbers",
      "ruleType": "regex",
      "scope": "both",
      "config": {"pattern": "\\b\\d{8,17}\\b", "message": "Potential bank account number detected"},
      "severity": "high",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Bank Account Detector"

  curl -s -X POST "$API/guardrails/profiles/$FIN_PROFILE/rules" \
    -H "$H1" -H "$AUTH" \
    -d '{
      "name": "Investment Advice Blocker",
      "description": "Blocks unauthorized investment recommendations",
      "ruleType": "content_filter",
      "scope": "output",
      "config": {"keywords": ["buy this stock", "sell your shares", "guaranteed returns", "invest now", "financial guarantee", "risk-free investment"]},
      "severity": "critical",
      "isEnabled": true
    }' > /dev/null 2>&1
  echo "    ✓ Investment Advice Blocker"
else
  echo "  ✗ Failed to create Financial profile"
fi


# ── Assign profiles to agents ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ASSIGNING PROFILES TO AGENTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get agent IDs
CORP_ID=$(curl -s -H "$H2" "$API/agents/corpgcpmcp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))")
FIN_ID=$(curl -s -H "$H2" "$API/agents/finance-agent" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)

if [ -n "$CORP_ID" ] && [ -n "$PII_PROFILE" ]; then
  echo "→ Assigning PII Protection → corpgcpmcp"
  curl -s -X POST "$API/guardrails/assign" -H "$H1" -H "$AUTH" \
    -d "{\"agentId\":\"$CORP_ID\",\"profileId\":\"$PII_PROFILE\"}" > /dev/null 2>&1
  echo "  ✓ Done"
fi

if [ -n "$CORP_ID" ] && [ -n "$INJECT_PROFILE" ]; then
  echo "→ Assigning Prompt Injection Defense → corpgcpmcp"
  curl -s -X POST "$API/guardrails/assign" -H "$H1" -H "$AUTH" \
    -d "{\"agentId\":\"$CORP_ID\",\"profileId\":\"$INJECT_PROFILE\"}" > /dev/null 2>&1
  echo "  ✓ Done"
fi

if [ -n "$CORP_ID" ] && [ -n "$SAFETY_PROFILE" ]; then
  echo "→ Assigning Content Safety Monitor → corpgcpmcp"
  curl -s -X POST "$API/guardrails/assign" -H "$H1" -H "$AUTH" \
    -d "{\"agentId\":\"$CORP_ID\",\"profileId\":\"$SAFETY_PROFILE\"}" > /dev/null 2>&1
  echo "  ✓ Done"
fi

if [ -n "$FIN_ID" ] && [ -n "$FIN_PROFILE" ]; then
  echo "→ Assigning Financial Data Guard → finance-agent"
  curl -s -X POST "$API/guardrails/assign" -H "$H1" -H "$AUTH" \
    -d "{\"agentId\":\"$FIN_ID\",\"profileId\":\"$FIN_PROFILE\"}" > /dev/null 2>&1
  echo "  ✓ Done"
fi

if [ -n "$FIN_ID" ] && [ -n "$PII_PROFILE" ]; then
  echo "→ Assigning PII Protection → finance-agent"
  curl -s -X POST "$API/guardrails/assign" -H "$H1" -H "$AUTH" \
    -d "{\"agentId\":\"$FIN_ID\",\"profileId\":\"$PII_PROFILE\"}" > /dev/null 2>&1
  echo "  ✓ Done"
fi


# ============================================
# COMPLIANCE CONFIGURATIONS
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  COMPLIANCE CONFIGURATIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Config 1: SOX Compliance ──
echo ""
echo "→ Creating SOX Compliance config..."
curl -s -X POST "$API/compliance/configs" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "SOX Financial Controls",
    "description": "Sarbanes-Oxley compliance monitoring for AI agents handling financial data. Ensures audit trails, access controls, and data integrity.",
    "framework": "SOX",
    "version": "2026.1",
    "rules": [
      {
        "ruleId": "SOX-302",
        "name": "CEO/CFO Certification Controls",
        "description": "All financial AI outputs must have audit trail and human review capability",
        "severity": "critical",
        "category": "financial_reporting",
        "checkType": "audit_trail",
        "config": {"requireAuditLog": true, "requireHumanReview": true, "retentionDays": 2555}
      },
      {
        "ruleId": "SOX-404",
        "name": "Internal Control Assessment",
        "description": "AI agent access to financial systems must be logged and reviewed quarterly",
        "severity": "critical",
        "category": "internal_controls",
        "checkType": "access_review",
        "config": {"reviewFrequency": "quarterly", "requireApproval": true}
      },
      {
        "ruleId": "SOX-802",
        "name": "Document Retention",
        "description": "All AI-generated financial reports must be retained for 7 years",
        "severity": "high",
        "category": "record_keeping",
        "checkType": "retention",
        "config": {"retentionYears": 7, "immutableStorage": true}
      }
    ],
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('success',False); print(f'  ✓ SOX config created' if s else f'  ✗ {d.get(\"error\",\"Failed\")}')"

# ── Config 2: HIPAA Compliance ──
echo ""
echo "→ Creating HIPAA Compliance config..."
curl -s -X POST "$API/compliance/configs" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "HIPAA Privacy & Security",
    "description": "Health Insurance Portability and Accountability Act compliance for AI agents handling protected health information (PHI).",
    "framework": "HIPAA",
    "version": "2026.1",
    "rules": [
      {
        "ruleId": "HIPAA-164.312a",
        "name": "Access Control",
        "description": "Technical safeguards for access control to PHI processed by AI agents",
        "severity": "critical",
        "category": "technical_safeguards",
        "checkType": "access_control",
        "config": {"requireMFA": true, "requireEncryption": true, "sessionTimeout": 900}
      },
      {
        "ruleId": "HIPAA-164.312b",
        "name": "Audit Controls",
        "description": "Hardware, software, and procedural mechanisms to record and examine access to PHI",
        "severity": "critical",
        "category": "audit_controls",
        "checkType": "audit_trail",
        "config": {"logAllAccess": true, "retentionYears": 6, "tamperProof": true}
      },
      {
        "ruleId": "HIPAA-164.312c",
        "name": "Integrity Controls",
        "description": "Protect PHI from improper alteration or destruction by AI agents",
        "severity": "critical",
        "category": "data_integrity",
        "checkType": "integrity",
        "config": {"checksumValidation": true, "versionControl": true}
      },
      {
        "ruleId": "HIPAA-164.312e",
        "name": "Transmission Security",
        "description": "Guard against unauthorized access to PHI during electronic transmission",
        "severity": "critical",
        "category": "transmission_security",
        "checkType": "encryption",
        "config": {"requireTLS": true, "minTLSVersion": "1.2", "encryptAtRest": true}
      },
      {
        "ruleId": "HIPAA-164.530",
        "name": "Minimum Necessary Standard",
        "description": "AI agents must only access the minimum necessary PHI for the intended purpose",
        "severity": "high",
        "category": "privacy_rule",
        "checkType": "data_minimization",
        "config": {"enforceMinimumNecessary": true, "dataClassification": "PHI"}
      }
    ],
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('success',False); print(f'  ✓ HIPAA config created' if s else f'  ✗ {d.get(\"error\",\"Failed\")}')"

# ── Config 3: GDPR Compliance ──
echo ""
echo "→ Creating GDPR Compliance config..."
curl -s -X POST "$API/compliance/configs" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "GDPR Data Protection",
    "description": "General Data Protection Regulation compliance for AI agents processing personal data of EU/EEA residents.",
    "framework": "GDPR",
    "version": "2026.1",
    "rules": [
      {
        "ruleId": "GDPR-Art5",
        "name": "Data Processing Principles",
        "description": "Ensure lawfulness, fairness, transparency, purpose limitation, and data minimization",
        "severity": "critical",
        "category": "processing_principles",
        "checkType": "data_processing",
        "config": {"requireLawfulBasis": true, "purposeLimitation": true, "dataMinimization": true}
      },
      {
        "ruleId": "GDPR-Art13",
        "name": "Transparency Obligation",
        "description": "AI agents must disclose they are AI-powered when interacting with data subjects",
        "severity": "high",
        "category": "transparency",
        "checkType": "disclosure",
        "config": {"requireAIDisclosure": true, "provideDataSubjectRights": true}
      },
      {
        "ruleId": "GDPR-Art17",
        "name": "Right to Erasure",
        "description": "Support right to be forgotten — AI training data and agent memories must be deletable",
        "severity": "critical",
        "category": "data_subject_rights",
        "checkType": "erasure",
        "config": {"supportDeletion": true, "maxErasureTime": "30 days"}
      },
      {
        "ruleId": "GDPR-Art25",
        "name": "Data Protection by Design",
        "description": "AI systems must implement privacy by design and default",
        "severity": "high",
        "category": "privacy_by_design",
        "checkType": "design_review",
        "config": {"privacyByDefault": true, "dpia_required": true}
      },
      {
        "ruleId": "GDPR-Art33",
        "name": "Breach Notification",
        "description": "Report AI-related data breaches to supervisory authority within 72 hours",
        "severity": "critical",
        "category": "breach_notification",
        "checkType": "incident_response",
        "config": {"notificationWindow": "72 hours", "requireDocumentation": true}
      }
    ],
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('success',False); print(f'  ✓ GDPR config created' if s else f'  ✗ {d.get(\"error\",\"Failed\")}')"

# ── Config 4: PCI-DSS Compliance ──
echo ""
echo "→ Creating PCI-DSS Compliance config..."
curl -s -X POST "$API/compliance/configs" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "PCI-DSS Payment Security",
    "description": "Payment Card Industry Data Security Standard compliance for AI agents that process, store, or transmit cardholder data.",
    "framework": "PCI-DSS",
    "version": "4.0",
    "rules": [
      {
        "ruleId": "PCI-Req3",
        "name": "Protect Stored Cardholder Data",
        "description": "AI agents must not store sensitive authentication data after authorization",
        "severity": "critical",
        "category": "data_protection",
        "checkType": "data_storage",
        "config": {"noSADStorage": true, "maskPAN": true, "encryptCHD": true}
      },
      {
        "ruleId": "PCI-Req4",
        "name": "Encrypt Transmission",
        "description": "Use strong cryptography for cardholder data transmitted over open networks",
        "severity": "critical",
        "category": "encryption",
        "checkType": "transport_security",
        "config": {"requireTLS12": true, "noWeakCiphers": true}
      },
      {
        "ruleId": "PCI-Req10",
        "name": "Track and Monitor Access",
        "description": "Track all access to cardholder data by AI agents",
        "severity": "critical",
        "category": "monitoring",
        "checkType": "audit_trail",
        "config": {"logAllAccess": true, "retentionDays": 365, "dailyLogReview": true}
      }
    ],
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('success',False); print(f'  ✓ PCI-DSS config created' if s else f'  ✗ {d.get(\"error\",\"Failed\")}')"

# ── Config 5: EU AI Act ──
echo ""
echo "→ Creating EU AI Act Compliance config..."
curl -s -X POST "$API/compliance/configs" \
  -H "$H1" -H "$AUTH" \
  -d '{
    "name": "EU AI Act Compliance",
    "description": "European Union AI Act compliance for high-risk AI systems. Covers transparency, human oversight, and risk management requirements.",
    "framework": "EU-AI-ACT",
    "version": "2026.1",
    "rules": [
      {
        "ruleId": "EUAI-Art9",
        "name": "Risk Management System",
        "description": "High-risk AI must have a risk management system throughout its lifecycle",
        "severity": "critical",
        "category": "risk_management",
        "checkType": "risk_assessment",
        "config": {"requireRiskAssessment": true, "continuousMonitoring": true}
      },
      {
        "ruleId": "EUAI-Art13",
        "name": "Transparency",
        "description": "AI systems must be transparent — users must know they are interacting with AI",
        "severity": "high",
        "category": "transparency",
        "checkType": "disclosure",
        "config": {"requireAILabel": true, "explainableOutputs": true}
      },
      {
        "ruleId": "EUAI-Art14",
        "name": "Human Oversight",
        "description": "High-risk AI must have appropriate human oversight measures",
        "severity": "critical",
        "category": "human_oversight",
        "checkType": "oversight",
        "config": {"humanInTheLoop": true, "overrideCapability": true, "escalationPath": true}
      },
      {
        "ruleId": "EUAI-Art15",
        "name": "Accuracy and Robustness",
        "description": "AI systems must achieve appropriate levels of accuracy, robustness, and cybersecurity",
        "severity": "high",
        "category": "performance",
        "checkType": "quality_assurance",
        "config": {"accuracyThreshold": 0.95, "adversarialTesting": true, "biasMonitoring": true}
      }
    ],
    "isActive": true
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('success',False); print(f'  ✓ EU AI Act config created' if s else f'  ✗ {d.get(\"error\",\"Failed\")}')"


# ============================================
# VERIFICATION
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VERIFICATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "→ Guardrail Profiles:"
curl -s -H "$H2" "$API/guardrails/profiles" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d.get('data', []):
    print(f\"  [{p.get('mode','?'):5s}] {p.get('name','?'):35s} | Rules: {p.get('rule_count','0'):>2} | Agents: {p.get('agent_count','0'):>2} | Active: {p.get('is_active')}\")" 2>&1

echo ""
echo "→ Compliance Configs:"
curl -s -H "$AUTH" "$API/compliance/configs" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('data', []):
    rules = c.get('rules', [])
    print(f\"  {c.get('framework','?'):12s} | {c.get('name','?'):35s} | Rules: {len(rules):>2} | Active: {c.get('isActive', c.get('is_active'))}\")" 2>&1

echo ""
echo "============================================"
echo "  ✅ Sample data seeding complete!"
echo "============================================"
