# OpenTelemetry Observability — AgentShield

> **Version**: 0.1.0  
> **Last Updated**: June 2026  
> **Status**: Implemented & Verified

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture — How It Currently Works](#architecture--how-it-currently-works)
3. [Components Explained](#components-explained)
4. [What Gets Traced](#what-gets-traced)
5. [Metrics Collected](#metrics-collected)
6. [Log Correlation](#log-correlation)
7. [Configuration Reference](#configuration-reference)
8. [Running Locally](#running-locally)
9. [Dashboard Integration](#dashboard-integration)
10. [Enhancement Roadmap](#enhancement-roadmap)
11. [Backend Options](#backend-options)
12. [Production Deployment Guide](#production-deployment-guide)
13. [Troubleshooting](#troubleshooting)

---

## Overview

AgentShield uses **OpenTelemetry (OTel)** for distributed tracing, custom metrics, and log correlation across its governance firewall. Every request flowing through the gateway — authentication, policy evaluation, budget checking, agent invocation, compliance sampling, and audit logging — is instrumented with spans, metrics, and trace-correlated logs.

### What is OpenTelemetry?

OpenTelemetry is a vendor-neutral, open-source observability framework. It provides:

- **Traces**: Follow a single request across the entire system, seeing exactly what happened at each step
- **Metrics**: Counters (how many), histograms (distribution of values), gauges (current value)
- **Logs**: Structured logs enriched with trace context for correlation

### What is OTLP?

**OTLP (OpenTelemetry Protocol)** is the standard wire format for sending telemetry. It's the "common language" all observability tools speak. Your app always outputs OTLP — the receiving backend (Jaeger, Grafana, Datadog, etc.) is just a configuration choice, not a code change.

---

## Architecture — How It Currently Works

```
┌──────────────────────────────────────────────────────────┐
│                     AgentShield                          │
│                                                          │
│  ┌──────────────┐   Loaded FIRST before Express          │
│  │  tracing.js  │   Initializes OTel SDK with:           │
│  │  (SDK Boot)  │   • Auto-instrumentation (Express,     │
│  │              │     HTTP, PostgreSQL, Redis, DNS)       │
│  │              │   • OTLP or Console exporter            │
│  └──────┬───────┘                                        │
│         │                                                │
│  ┌──────▼───────────────────────────────────────────┐    │
│  │              Express Middleware Chain              │    │
│  │                                                   │    │
│  │  ┌─────────────┐  Manual span + metric            │    │
│  │  │ authenticate │  auth.method, auth.success       │    │
│  │  └──────┬──────┘                                  │    │
│  │  ┌──────▼──────┐  Manual span + metric            │    │
│  │  │  policy     │  decision, policy_name, latency   │    │
│  │  └──────┬──────┘                                  │    │
│  │  ┌──────▼──────┐  Manual span + metric            │    │
│  │  │  budget     │  decision, scope, limit_type      │    │
│  │  └──────┬──────┘                                  │    │
│  │  ┌──────▼──────┐  Manual span + metric            │    │
│  │  │  agent.fwd  │  protocol, tokens, latency        │    │
│  │  └──────┬──────┘                                  │    │
│  │  ┌──────▼──────┐  Manual span (async)             │    │
│  │  │  compliance │  pii_detected, agent_slug         │    │
│  │  └──────┬──────┘                                  │    │
│  │  ┌──────▼──────┐  Manual span (on res.finish)     │    │
│  │  │  audit.log  │  event_type, outcome, status      │    │
│  │  └─────────────┘                                  │    │
│  └───────────────────────────────────────────────────┘    │
│         │                                                │
│  ┌──────▼───────┐                                        │
│  │ metrics.js   │  8 counters + 5 histograms             │
│  └──────────────┘                                        │
│         │                                                │
│  ┌──────▼───────┐                                        │
│  │ logger.js    │  Winston + trace_id/span_id injection  │
│  └──────────────┘                                        │
│         │                                                │
│  ┌──────▼───────┐   OTLP/HTTP exporter                  │
│  │ Trace Export │──────────────────────────────────┐      │
│  └──────────────┘                                 │      │
└───────────────────────────────────────────────────│──────┘
                                                    │
                                          ┌─────────▼────────┐
                                          │     Jaeger        │
                                          │  :4318 (OTLP in)  │
                                          │  :16686 (Web UI)   │
                                          └──────────────────┘
```

### Data Flow

1. **Request arrives** → Express auto-instrumentation creates an HTTP span
2. **traceId middleware** → Extracts the OTel trace ID, sets it as `req.traceId`
3. **Each middleware** → Creates a child span with domain-specific attributes and records metrics
4. **Agent forward** → Creates nested spans for upstream HTTP calls or MCP protocol
5. **Response sent** → Audit span captures final status code and latency
6. **OTel SDK** → Batches spans and exports via OTLP to Jaeger (or prints to console)

---

## Components Explained

### Files Modified/Created

| File | Role |
|------|------|
| `src/config/tracing.js` | **SDK Bootstrap** — Initializes NodeSDK with auto-instrumentations, OTLP exporter, resource identity. Must be loaded FIRST. |
| `src/config/metrics.js` | **Metric Registry** — Defines all custom counters and histograms using `@opentelemetry/api` |
| `src/config/logger.js` | **Log Correlation** — Injects `trace_id` and `span_id` into every Winston log line |
| `src/gateway/middleware/index.js` | **Firewall Spans** — Wraps authenticate, policy, budget, compliance, audit in OTel spans |
| `src/gateway/proxy.js` | **Proxy Spans** — Wraps agent invoke, workflow run, forwardToAgent in spans |
| `src/gateway/mcp-client.js` | **MCP Spans** — Wraps MCP connect, list_tools, call_tool lifecycle |
| `src/index.js` | **Lifecycle** — Loads tracing first, adds graceful OTel shutdown |
| `src/admin/routes.js` | **Health Endpoint** — `GET /observability/health` for dashboard |

### NPM Packages

```
@opentelemetry/api                        — Core API (tracer, meter, context)
@opentelemetry/sdk-node                   — Node.js SDK (bundles everything)
@opentelemetry/sdk-trace-node             — Trace provider for Node
@opentelemetry/auto-instrumentations-node — Auto-instruments Express, pg, http, etc.
@opentelemetry/exporter-trace-otlp-http   — Sends traces via OTLP/HTTP
@opentelemetry/exporter-metrics-otlp-http — Sends metrics via OTLP/HTTP
@opentelemetry/sdk-metrics                — Metric reader and exporter
@opentelemetry/resources                  — Service identity (name, version, env)
@opentelemetry/semantic-conventions       — Standard attribute names
```

---

## What Gets Traced

### Span Hierarchy for a Gateway Request

```
HTTP POST /api/v1/gateway/agents/gpt-analyst/invoke        [auto: express]
  ├─ agentshield.authenticate                               [manual]
  │     Attributes: auth.method, auth.user_id, auth.role, auth.success
  │
  ├─ agentshield.policy.evaluate                            [manual]
  │     Attributes: policy.decision, policy.name, policy.latency_ms
  │
  ├─ agentshield.budget.check                               [manual]
  │     Attributes: budget.decision, budget.scope
  │
  ├─ agentshield.agent.invoke                               [manual]
  │  │  Attributes: agent.slug, agent.name, agent.protocol, agent.vendor
  │  │
  │  └─ agentshield.agent.forward                           [manual]
  │     │  Attributes: agent.protocol (http/mcp), agent.endpoint
  │     │
  │     └─ HTTP POST https://api.openai.com/v1/chat/...     [auto: http]
  │          └─ pg.query: INSERT INTO cost_records           [auto: pg]
  │
  ├─ agentshield.compliance.sample                          [manual, async]
  │     Attributes: compliance.sampled, compliance.pii_detected
  │
  └─ agentshield.audit.log                                  [manual, on res.finish]
       Attributes: audit.event_type, audit.outcome, audit.status_code, audit.latency_ms
       └─ pg.query: INSERT INTO audit_log                   [auto: pg]
```

### Span Hierarchy for a Workflow

```
agentshield.workflow.run
  │  Attributes: workflow.slug, workflow.name, workflow.total_steps
  │
  ├─ agentshield.workflow.step[0]
  │  │  Attributes: step.index, step.agent_slug, step.latency_ms
  │  └─ agentshield.agent.forward → HTTP POST upstream
  │
  ├─ agentshield.workflow.step[1]
  │  └─ agentshield.agent.forward → HTTP POST upstream
  │
  └─ agentshield.workflow.step[2]
     └─ agentshield.agent.forward → MCP protocol
        ├─ agentshield.mcp.connect
        ├─ agentshield.mcp.list_tools
        └─ agentshield.mcp.call_tool
```

### MCP Protocol Spans

```
agentshield.mcp.invoke
  │  Attributes: mcp.endpoint
  │
  ├─ agentshield.mcp.connect          (SSE transport initialization)
  ├─ agentshield.mcp.list_tools       (tool_count, tool_names)
  └─ agentshield.mcp.call_tool        (tool_name, call_type)
```

---

## Metrics Collected

### Counters (Incremented per event)

| Metric | Labels | Purpose |
|--------|--------|---------|
| `agentshield.requests.total` | method, route, status_code | Total gateway requests |
| `agentshield.policy.decisions` | decision, policy_name | Policy evaluation outcomes |
| `agentshield.policy.denials` | reason, agent_slug | Policy denial count |
| `agentshield.auth.failures` | method, reason | Authentication failures |
| `agentshield.budget.exceeded` | scope, limit_type | Budget limit hits |
| `agentshield.compliance.pii_detected` | pii_type, agent_slug | PII detection events |
| `agentshield.compliance.samples` | agent_slug | Compliance samples taken |
| `agentshield.eval.runs` | mode, status | Evaluation runs executed |

### Histograms (Distribution of values)

| Metric | Buckets (ms) | Purpose |
|--------|-------------|---------|
| `agentshield.gateway.latency_ms` | 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 | End-to-end request latency |
| `agentshield.policy.evaluate_ms` | 1, 5, 10, 25, 50, 100 | Policy evaluation duration |
| `agentshield.agent.upstream_latency_ms` | 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000 | Upstream agent response time |
| `agentshield.agent.tokens` | 100, 500, 1000, 5000, 10000, 50000 | Token usage per invocation |
| `agentshield.eval.scenario_latency_ms` | 100, 500, 1000, 5000, 15000, 30000 | Per-scenario evaluation time |

---

## Log Correlation

Every Winston log line now includes OTel trace context:

```json
{
  "level": "info",
  "message": "Policy evaluated",
  "trace_id": "c508fcaf28f6bcc00bf9a3ccdfea7df9",
  "span_id": "92353f1b83ba927e",
  "trace_flags": 1,
  "service": "agentshield",
  "timestamp": "2026-06-22 12:34:56.789"
}
```

This allows you to:
- Search logs by `trace_id` to find all logs for a specific request
- Jump from a log entry to the full trace in Jaeger
- Correlate errors in logs with the exact span that caused them

---

## Configuration Reference

All configuration is via environment variables (no code changes needed):

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty = console)* | OTLP collector URL. Set to `http://localhost:4318` for Jaeger |
| `OTEL_SERVICE_NAME` | `agentshield` | Service name shown in trace backends |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Sampling rate (0.0 to 1.0). Use `0.1` for 10% sampling in production |
| `OTEL_LOG_LEVEL` | *(empty)* | Set to `debug` for OTel SDK diagnostic output |
| `OTEL_METRICS_EXPORT_INTERVAL` | `30000` | Metrics export interval in milliseconds |
| `NODE_ENV` | `development` | Sets `deployment.environment` resource attribute |

---

## Running Locally

### Option 1: Console Exporter (Simplest)

```bash
# Spans print to terminal stdout
node src/index.js
```

### Option 2: Jaeger (Visual Traces)

```bash
# Start Jaeger
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Start AgentShield pointing at Jaeger
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node src/index.js

# Open Jaeger UI
open http://localhost:16686
```

### Option 3: Verification Script

```bash
# Start server first, then run:
node scripts/verify-otel.js
```

This sends test requests and tells you exactly what spans to expect.

---

## Dashboard Integration

The AgentShield Dashboard includes an **Observability** page (Monitoring → Observability):

### Features

| Feature | Description |
|---------|-------------|
| **Trace Exporter Status** | Shows connected/disconnected with live health checks (auto-refreshes every 30s) |
| **Audit Metrics** | Total events, allowed, denied counts at a glance |
| **Quick Links** | Direct links to Jaeger UI and Grafana (configurable) |
| **Configuration** | Set Jaeger and Grafana URLs, saved to localStorage |
| **Recent Traces** | Last 20 audit events with clickable trace IDs → opens in Jaeger |

### Clickable Trace IDs

Trace IDs in both the **Audit Log** and **Observability** pages are clickable links that open the trace directly in Jaeger. The Jaeger URL is configurable from the Observability settings panel.

---

## Enhancement Roadmap

### Phase 1 — Current (Implemented ✅)

- [x] SDK bootstrap with auto-instrumentation
- [x] Manual spans for all 5 firewall middlewares
- [x] Manual spans for proxy, workflow, and MCP
- [x] 8 counters + 5 histograms
- [x] Winston log correlation
- [x] Dashboard Observability page
- [x] Clickable trace IDs in Audit Log

### Phase 2 — OTel Collector (Recommended Next Step)

Add an **OpenTelemetry Collector** between AgentShield and the backends. This decouples your app from the specific backend:

```
AgentShield → OTLP → OTel Collector → Jaeger
                                     → Grafana
                                     → Datadog
                                     → PagerDuty
```

**Benefits**:
- Switch/add backends without restarting the app
- Fan-out traces to multiple destinations simultaneously
- Add sampling, filtering, and PII redaction at the collector level
- Buffer and retry on network failures

**Implementation**: Add `otel-collector-config.yaml` + Docker service (see [Production Deployment](#production-deployment-guide))

### Phase 3 — Grafana Stack

Add **Grafana + Tempo + Prometheus** for a full observability stack:

```
AgentShield → OTel Collector → Tempo      (traces)
                              → Prometheus  (metrics)
                              → Loki        (logs)
                                    ↓
                               Grafana Dashboard
                               (unified view)
```

**What you get**:
- Pre-built dashboards for request rates, error rates, latencies (RED metrics)
- Alerting on SLO breaches (e.g., p99 latency > 2s, error rate > 5%)
- Exemplars: click a metric spike → jump to the exact trace that caused it

### Phase 4 — Evaluation Instrumentation

Instrument `src/evaluation/service.js` (917 lines) with spans for:
- `agentshield.eval.run` — full evaluation execution
- `agentshield.eval.scenario` — per-scenario with agent invocation
- `agentshield.eval.judge` — LLM judge scoring
- Token usage and cost tracking per evaluation

### Phase 5 — Custom Dashboards

Build pre-configured Grafana dashboards for AgentShield:

| Dashboard | Panels |
|-----------|--------|
| **Gateway Overview** | Request rate, error rate, p50/p95/p99 latency, top agents by traffic |
| **Policy Analytics** | Denial rate by policy, top denied agents, policy evaluation latency |
| **Cost Control** | Token usage by agent, cost per day/week, budget utilization % |
| **Compliance** | PII detection rate, compliance sample coverage, violation trends |
| **Agent Health** | Per-agent latency, error rate, health check status |

### Phase 6 — Advanced Features

| Feature | Description |
|---------|-------------|
| **Tail-based sampling** | Only export traces that contain errors or exceed latency thresholds |
| **Baggage propagation** | Pass `userId`, `tenantId` through the entire trace context |
| **Span links** | Link compliance check spans to the original agent invocation |
| **Custom exporters** | Export governance events to SIEM tools (Splunk, Elastic) |
| **Browser tracing** | Add OTel to the dashboard frontend for end-to-end traces (browser → API → DB) |
| **SLO monitoring** | Define SLOs (99.9% availability, p99 < 500ms) and alert on breaches |

---

## Backend Options

### Comparison of Trace Backends

| Backend | Type | Traces | Metrics | Logs | Alerting | Cost |
|---------|------|--------|---------|------|----------|------|
| **Jaeger** | OSS | ✅ | ❌ | ❌ | ❌ | Free |
| **Grafana Tempo** | OSS | ✅ | ❌ | ❌ | via Grafana | Free |
| **Grafana Stack** | OSS | ✅ (Tempo) | ✅ (Prometheus) | ✅ (Loki) | ✅ | Free |
| **Grafana Cloud** | SaaS | ✅ | ✅ | ✅ | ✅ | Free tier + paid |
| **Datadog** | SaaS | ✅ | ✅ | ✅ | ✅ | $$$  |
| **New Relic** | SaaS | ✅ | ✅ | ✅ | ✅ | Free tier + paid |
| **AWS X-Ray** | Cloud | ✅ | ❌ | ❌ | via CloudWatch | Pay per trace |
| **Elastic APM** | OSS/SaaS | ✅ | ✅ | ✅ | ✅ | Free tier + paid |
| **SigNoz** | OSS | ✅ | ✅ | ✅ | ✅ | Free |
| **Zipkin** | OSS | ✅ | ❌ | ❌ | ❌ | Free |

### Recommendation by Stage

| Stage | Recommended Setup |
|-------|-------------------|
| **Local Development** | Jaeger all-in-one (Docker) — simplest setup |
| **Staging** | OTel Collector + Jaeger + Prometheus |
| **Production (Self-hosted)** | OTel Collector + Grafana Stack (Tempo + Prometheus + Loki) |
| **Production (Managed)** | OTel Collector + Grafana Cloud or Datadog |

### Switching Backends

**Without OTel Collector** (current): Change `OTEL_EXPORTER_OTLP_ENDPOINT` env var → restart app.

**With OTel Collector** (recommended): Edit collector YAML config → restart collector only. Zero app changes.

---

## Production Deployment Guide

### Docker Compose with OTel Collector

```yaml
# docker-compose.observability.yaml

services:
  # ─── OTel Collector ───
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes:
      - ./configs/otel-collector.yaml:/etc/otelcol/config.yaml
    ports:
      - "4318:4318"     # OTLP HTTP receiver
    depends_on:
      - jaeger

  # ─── Jaeger ───
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"   # Jaeger UI
      - "4317:4317"     # OTLP gRPC (from collector)
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

  # ─── Prometheus (optional, for metrics) ───
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./configs/prometheus.yaml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  # ─── Grafana (optional, unified dashboard) ───
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin"
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  grafana-data:
```

### OTel Collector Configuration

```yaml
# configs/otel-collector.yaml

receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

  # Redact sensitive attributes before export
  attributes:
    actions:
      - key: db.statement
        action: hash        # Hash SQL queries
      - key: http.request.header.authorization
        action: delete      # Remove auth headers

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

  prometheus:
    endpoint: "0.0.0.0:8889"

  # Uncomment to add Grafana Cloud:
  # otlp/grafana:
  #   endpoint: "tempo-us-central1.grafana.net:443"
  #   headers:
  #     Authorization: "Basic <base64-encoded-credentials>"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, attributes]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

### AgentShield Environment

```bash
# .env (production)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=agentshield
OTEL_TRACES_SAMPLER_ARG=0.1          # 10% sampling in production
OTEL_METRICS_EXPORT_INTERVAL=60000   # Export metrics every 60s
NODE_ENV=production
```

---

## Troubleshooting

### No spans appearing

1. **Check tracing.js loads first**: It must be the first `require()` in `src/index.js`
2. **Check exporter endpoint**: `echo $OTEL_EXPORTER_OTLP_ENDPOINT`
3. **Enable debug logging**: `OTEL_LOG_LEVEL=debug node src/index.js`
4. **Verify Jaeger is running**: `curl http://localhost:16686/api/services`

### Spans appear but no custom attributes

- Verify the middleware is using `tracer.startActiveSpan()` (not `tracer.startSpan()`)
- Check that `span.setAttribute()` is called before `span.end()`

### Trace IDs don't match in Jaeger

- Old audit records may have UUID-format trace IDs (pre-OTel). These won't match OTel trace IDs.
- New requests (post-OTel) will have proper 32-character hex trace IDs that Jaeger can resolve.

### High memory usage

- Reduce batch size: set `OTEL_BSP_MAX_EXPORT_BATCH_SIZE=256`
- Increase export interval: set `OTEL_BSP_SCHEDULE_DELAY=10000`
- Lower sampling rate: set `OTEL_TRACES_SAMPLER_ARG=0.1`

### Console exporter too noisy

- Set `OTEL_EXPORTER_OTLP_ENDPOINT` to any URL (even invalid) to switch away from console
- Or reduce auto-instrumentation scope in `tracing.js`

---

## Glossary

| Term | Definition |
|------|-----------|
| **Span** | A single unit of work with a name, start time, duration, attributes, and status |
| **Trace** | A tree of spans representing a complete request flow |
| **Trace ID** | 32-character hex string uniquely identifying a trace across all services |
| **Span ID** | 16-character hex string uniquely identifying a span within a trace |
| **OTLP** | OpenTelemetry Protocol — the standard format for exporting telemetry data |
| **Exporter** | Component that sends telemetry to a backend (Jaeger, Grafana, Datadog, etc.) |
| **Collector** | A standalone proxy that receives, processes, and exports telemetry |
| **Auto-instrumentation** | Automatic span creation for libraries (Express, pg, HTTP) without code changes |
| **Manual instrumentation** | Explicit `tracer.startActiveSpan()` calls for business-specific spans |
| **Sampling** | Controlling what percentage of traces are exported (cost control in production) |
| **Baggage** | Key-value pairs propagated through the trace context across services |
| **Resource** | Metadata identifying the service (name, version, environment) |
| **Meter** | OTel API for creating metrics (counters, histograms, gauges) |
