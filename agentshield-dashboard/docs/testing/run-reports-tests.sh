#!/bin/bash
# ================================================================
# Reports Module — Automated Test Runner
# Runs all API test cases from reports-test-cases.html
# ================================================================

set -e

BASE_URL="http://localhost:3000/api/v1"
PASS=0
FAIL=0
RESULTS=""

# Get auth token
TOKEN=$(curl -s "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@agentshield.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

AUTH="Authorization: Bearer $TOKEN"

log_result() {
    local tc_id="$1"
    local test_name="$2"
    local status="$3"
    local details="$4"
    if [ "$status" = "PASS" ]; then
        PASS=$((PASS + 1))
        RESULTS="${RESULTS}\n✅ ${tc_id} | ${test_name} | ${details}"
    else
        FAIL=$((FAIL + 1))
        RESULTS="${RESULTS}\n❌ ${tc_id} | ${test_name} | ${details}"
    fi
}

echo "═══════════════════════════════════════════════════"
echo "  AgentShield Reports Module — Test Execution"
echo "═══════════════════════════════════════════════════"
echo ""

# ──────────────────────────────────────────────────────
# TC-R02: List report types
# ──────────────────────────────────────────────────────
echo "▶ TC-R02: List report types..."
RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/types")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
COUNT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")

if [ "$HTTP_CODE" = "200" ] && [ "$COUNT" = "16" ] && [ "$SUCCESS" = "True" ]; then
    log_result "TC-R02" "List Report Types" "PASS" "HTTP $HTTP_CODE, $COUNT types returned"
else
    log_result "TC-R02" "List Report Types" "FAIL" "HTTP $HTTP_CODE, got $COUNT types (expected 16), success=$SUCCESS"
fi

# ──────────────────────────────────────────────────────
# TC-R05 through TC-R22: Generate each report type
# ──────────────────────────────────────────────────────
REPORT_TYPES=(
    "access_decisions:TC-R05:Access Decision Summary"
    "policy_effectiveness:TC-R06:Policy Effectiveness"
    "compliance_posture:TC-R09:Compliance Posture"
    "compliance_history:TC-R10:Compliance History"
    "pii_exposure:TC-R11:PII Exposure"
    "audit_export:TC-R12:Audit Trail Export"
    "cost_overview:TC-R13:Cost Overview"
    "budget_utilization:TC-R14:Budget Utilization"
    "token_usage:TC-R15:Token Usage Analytics"
    "agent_health:TC-R16:Agent Health"
    "agent_scorecard:TC-R17:Agent Scorecard"
    "agent_invocations:TC-R18:Agent Invocations"
    "guardrail_violations:TC-R19:Guardrail Violations"
    "guardrail_coverage:TC-R20:Guardrail Coverage"
    "governance_posture:TC-R21:Governance Posture"
    "workflow_execution:TC-R22:Workflow Execution"
)

for entry in "${REPORT_TYPES[@]}"; do
    IFS=':' read -r type tc_id name <<< "$entry"
    echo "▶ ${tc_id}: Generate ${name}..."
    
    RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/${type}")
    HTTP_CODE=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')
    SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
    RPT_TYPE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('type',''))" 2>/dev/null || echo "")
    GEN_AT=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('generatedAt',''))" 2>/dev/null || echo "")
    LABEL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('label',''))" 2>/dev/null || echo "")
    
    if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ "$RPT_TYPE" = "$type" ] && [ -n "$GEN_AT" ]; then
        log_result "$tc_id" "$name" "PASS" "HTTP $HTTP_CODE, type=$RPT_TYPE, label='$LABEL'"
    else
        ERROR=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "parse error")
        log_result "$tc_id" "$name" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS, type=$RPT_TYPE, error=$ERROR"
    fi
done

# ──────────────────────────────────────────────────────
# TC-R23: CSV Export
# ──────────────────────────────────────────────────────
echo "▶ TC-R23: CSV Export..."
RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/access_decisions/export?format=csv")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
LINE_COUNT=$(echo "$BODY" | wc -l | tr -d ' ')
FIRST_LINE=$(echo "$BODY" | head -1)

if [ "$HTTP_CODE" = "200" ] && [ "$LINE_COUNT" -gt "1" ]; then
    log_result "TC-R23" "CSV Export" "PASS" "HTTP $HTTP_CODE, $LINE_COUNT lines, header='${FIRST_LINE:0:60}...'"
else
    log_result "TC-R23" "CSV Export" "FAIL" "HTTP $HTTP_CODE, $LINE_COUNT lines"
fi

# ──────────────────────────────────────────────────────
# TC-R24: XLSX Export
# ──────────────────────────────────────────────────────
echo "▶ TC-R24: XLSX Export..."
TMPFILE="/tmp/agentshield_test_report.xlsx"
HTTP_CODE=$(curl -s -w "%{http_code}" -H "$AUTH" "$BASE_URL/reports/cost_overview/export?format=xlsx" -o "$TMPFILE")
FILE_SIZE=$(wc -c < "$TMPFILE" 2>/dev/null | tr -d ' ')
FILE_TYPE=$(file "$TMPFILE" 2>/dev/null || echo "unknown")

if [ "$HTTP_CODE" = "200" ] && [ "$FILE_SIZE" -gt "100" ]; then
    log_result "TC-R24" "XLSX Export" "PASS" "HTTP $HTTP_CODE, size=${FILE_SIZE}B, type=$(echo $FILE_TYPE | head -c 60)"
else
    log_result "TC-R24" "XLSX Export" "FAIL" "HTTP $HTTP_CODE, size=${FILE_SIZE}B"
fi
rm -f "$TMPFILE"

# ──────────────────────────────────────────────────────
# TC-R25: Export with date filter
# ──────────────────────────────────────────────────────
echo "▶ TC-R25: Export with date range..."
RESP_FULL=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/audit_export/export?format=csv")
FULL_CODE=$(echo "$RESP_FULL" | tail -1)
FULL_BODY=$(echo "$RESP_FULL" | sed '$d')
FULL_LINES=$(echo "$FULL_BODY" | wc -l | tr -d ' ')

FROM=$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d "3 days ago" +%Y-%m-%d)
TO=$(date +%Y-%m-%d)
RESP_FILT=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/audit_export/export?format=csv&from=${FROM}&to=${TO}")
FILT_CODE=$(echo "$RESP_FILT" | tail -1)
FILT_BODY=$(echo "$RESP_FILT" | sed '$d')
FILT_LINES=$(echo "$FILT_BODY" | wc -l | tr -d ' ')

if [ "$FULL_CODE" = "200" ] && [ "$FILT_CODE" = "200" ]; then
    log_result "TC-R25" "Export with Date Range" "PASS" "Full: ${FULL_LINES} lines, Filtered: ${FILT_LINES} lines"
else
    log_result "TC-R25" "Export with Date Range" "FAIL" "Full HTTP=$FULL_CODE, Filtered HTTP=$FILT_CODE"
fi

# ──────────────────────────────────────────────────────
# TC-R26: Save snapshot
# ──────────────────────────────────────────────────────
echo "▶ TC-R26: Save snapshot..."
RESP=$(curl -s -w "\n%{http_code}" -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE_URL/reports/governance_posture/snapshot" \
  -d '{"name":"Test Snapshot - Automated","filters":{"from":"2026-07-01","to":"2026-07-06"}}')
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
SNAP_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ -n "$SNAP_ID" ]; then
    log_result "TC-R26" "Save Snapshot" "PASS" "HTTP $HTTP_CODE, id=$SNAP_ID"
else
    log_result "TC-R26" "Save Snapshot" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS"
fi

# ──────────────────────────────────────────────────────
# TC-R27: List snapshots
# ──────────────────────────────────────────────────────
echo "▶ TC-R27: List snapshots..."
RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/snapshots/list")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
SNAP_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")

if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ "$SNAP_COUNT" -ge "1" ]; then
    log_result "TC-R27" "List Snapshots" "PASS" "HTTP $HTTP_CODE, $SNAP_COUNT snapshots found"
else
    log_result "TC-R27" "List Snapshots" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS, count=$SNAP_COUNT"
fi

# ──────────────────────────────────────────────────────
# TC-R28: Get snapshot by ID
# ──────────────────────────────────────────────────────
echo "▶ TC-R28: Get snapshot by ID..."
if [ -n "$SNAP_ID" ]; then
    RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/snapshots/$SNAP_ID")
    HTTP_CODE=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')
    SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
    HAS_DATA=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('data' in d)" 2>/dev/null || echo "False")
    
    if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ "$HAS_DATA" = "True" ]; then
        log_result "TC-R28" "Get Snapshot by ID" "PASS" "HTTP $HTTP_CODE, data present"
    else
        log_result "TC-R28" "Get Snapshot by ID" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS, has_data=$HAS_DATA"
    fi
else
    log_result "TC-R28" "Get Snapshot by ID" "FAIL" "No snapshot ID from TC-R26"
fi

# ──────────────────────────────────────────────────────
# TC-R29: Save report config
# ──────────────────────────────────────────────────────
echo "▶ TC-R29: Save report config..."
RESP=$(curl -s -w "\n%{http_code}" -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE_URL/reports/configs" \
  -d '{"name":"Weekly Security Summary","report_type":"access_decisions","filters":{"from":"2026-07-01"},"schedule":"weekly","recipients":["security@example.com"]}')
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
CONFIG_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ -n "$CONFIG_ID" ]; then
    log_result "TC-R29" "Save Report Config" "PASS" "HTTP $HTTP_CODE, id=$CONFIG_ID"
else
    log_result "TC-R29" "Save Report Config" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS"
fi

# ──────────────────────────────────────────────────────
# TC-R30: List configs
# ──────────────────────────────────────────────────────
echo "▶ TC-R30: List configs..."
RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/configs/list")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
CFG_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")

if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ "$CFG_COUNT" -ge "1" ]; then
    log_result "TC-R30" "List Configs" "PASS" "HTTP $HTTP_CODE, $CFG_COUNT configs"
else
    log_result "TC-R30" "List Configs" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS, count=$CFG_COUNT"
fi

# ──────────────────────────────────────────────────────
# TC-R31: Delete config
# ──────────────────────────────────────────────────────
echo "▶ TC-R31: Delete config..."
if [ -n "$CONFIG_ID" ]; then
    RESP=$(curl -s -w "\n%{http_code}" -X DELETE -H "$AUTH" "$BASE_URL/reports/configs/$CONFIG_ID")
    HTTP_CODE=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')
    SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
    
    if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ]; then
        log_result "TC-R31" "Delete Config" "PASS" "HTTP $HTTP_CODE, deleted $CONFIG_ID"
    else
        log_result "TC-R31" "Delete Config" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS"
    fi
else
    log_result "TC-R31" "Delete Config" "FAIL" "No config ID from TC-R29"
fi

# ──────────────────────────────────────────────────────
# TC-R32: Invalid report type
# ──────────────────────────────────────────────────────
echo "▶ TC-R32: Invalid report type..."
RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/nonexistent_report")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
ERROR_MSG=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "")

if [ "$HTTP_CODE" = "400" ] && echo "$ERROR_MSG" | grep -qi "unknown report type"; then
    log_result "TC-R32" "Invalid Report Type" "PASS" "HTTP $HTTP_CODE, error='$ERROR_MSG'"
else
    log_result "TC-R32" "Invalid Report Type" "FAIL" "HTTP $HTTP_CODE, error='$ERROR_MSG' (expected 400 with 'Unknown report type')"
fi

# ──────────────────────────────────────────────────────
# TC-R33: Unauthenticated request
# ──────────────────────────────────────────────────────
echo "▶ TC-R33: Unauthenticated request..."
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/types")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
ERROR_CODE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")

if [ "$HTTP_CODE" = "401" ] && [ "$ERROR_CODE" = "AUTH_REQUIRED" ]; then
    log_result "TC-R33" "Unauthenticated Request" "PASS" "HTTP $HTTP_CODE, code=$ERROR_CODE"
else
    log_result "TC-R33" "Unauthenticated Request" "FAIL" "HTTP $HTTP_CODE, code=$ERROR_CODE (expected 401/AUTH_REQUIRED)"
fi

# ──────────────────────────────────────────────────────
# TC-R34: Empty date range (future dates)
# ──────────────────────────────────────────────────────
echo "▶ TC-R34: Report with no data (future dates)..."
RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/reports/access_decisions?from=2030-01-01&to=2030-01-31")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")
TOTAL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('summary',{}).get('total_requests','-1'))" 2>/dev/null || echo "-1")
TREND_LEN=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',{}).get('daily_trend',[])))" 2>/dev/null || echo "-1")

if [ "$HTTP_CODE" = "200" ] && [ "$SUCCESS" = "True" ] && [ "$TOTAL" = "0" ] && [ "$TREND_LEN" = "0" ]; then
    log_result "TC-R34" "Empty Data (Future Dates)" "PASS" "HTTP $HTTP_CODE, total=0, trend_len=0"
else
    log_result "TC-R34" "Empty Data (Future Dates)" "FAIL" "HTTP $HTTP_CODE, success=$SUCCESS, total=$TOTAL, trend=$TREND_LEN"
fi

# ──────────────────────────────────────────────────────
# RESULTS SUMMARY
# ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  TEST RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════"
echo -e "$RESULTS"
echo ""
echo "═══════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  TOTAL: $TOTAL | ✅ PASS: $PASS | ❌ FAIL: $FAIL"
if [ "$FAIL" -eq "0" ]; then
    echo "  🎉 ALL TESTS PASSED!"
else
    echo "  ⚠️  $FAIL TEST(S) FAILED — See details above"
fi
echo "═══════════════════════════════════════════════════"
