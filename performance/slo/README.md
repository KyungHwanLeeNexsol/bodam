# Bodam SLO (Service Level Objectives)

## Overview

This document defines the Service Level Objectives for the Bodam AI-powered insurance claim guidance platform. SLOs are enforced automatically via k6 thresholds in CI/CD.

## SLO Targets

### API Response Time

| Metric | Target | Enforcement |
|--------|--------|-------------|
| API p50 | < 200ms | k6 threshold |
| API p95 | < 1,000ms | k6 threshold |
| API p99 | < 3,000ms | k6 threshold |
| Chat/RAG p95 | < 3,000ms | k6 threshold |
| Vector Search p99 | < 200ms | k6 threshold |
| Health Check p99 | < 50ms | k6 threshold |

### Per-Endpoint SLOs

| Endpoint | p95 Target | Notes |
|----------|-----------|-------|
| POST /api/v1/auth/register | < 500ms | Includes bcrypt hashing |
| POST /api/v1/auth/login | < 500ms | Includes JWT signing |
| GET /api/v1/auth/me | < 200ms | Simple token validation |
| POST /api/v1/chat/sessions | < 500ms | DB write only |
| POST /api/v1/chat/sessions/{id}/messages | < 3,000ms | Includes LLM + vector search |
| GET /health | < 50ms | Lightweight health check |

### Throughput

| Metric | Target |
|--------|--------|
| Concurrent users (sustained) | 100 VUs for 30 minutes |
| Error rate (normal load) | < 0.1% |
| Error rate (stress load) | < 1% |
| Error rate (spike load) | < 10% |

## Measurement Methodology

### Tools

- **k6**: Primary load testing tool for API SLO measurement
- **k6 HTML Reporter**: Visual reports for each test run
- **GitHub Actions**: Automated SLO validation on every main branch push

### Test Types

| Test | VUs | Duration | Purpose |
|------|-----|----------|---------|
| Baseline | 10 | 1 minute | Normal load SLO validation |
| Stress | 0-100 (ramp) | 8 minutes | Breaking point detection |
| Spike | 200 (instant) | 50 seconds | Burst handling |
| Soak | 50 | 30 minutes | Memory leak & stability |

### Collection Process

1. Run `performance/k6/scenarios/baseline.js` against the target environment
2. Collect p50, p95, p99 for each endpoint using k6 tags
3. Record values in `baselines.json` after each production deployment
4. Compare against targets defined in this document

### Regression Detection

A performance regression is defined as:
- p95 response time increases by **more than 20%** compared to the previous baseline
- Error rate exceeds the target threshold

CI/CD will automatically fail if either condition is detected.

## Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| API p95 > 1,000ms | Warning | Investigate, notify on-call |
| API p99 > 3,000ms | Critical | Page on-call, rollback if recent deploy |
| Error rate > 1% | Critical | Immediate investigation |
| Vector search p99 > 200ms | Warning | Check pgvector index health |
| Memory growing > 20%/hour | Warning | Check for memory leaks |

## Baseline Update Process

After a significant performance improvement or infrastructure change:

1. Run the full baseline test suite against production
2. Record new p50/p95/p99 values in `baselines.json`
3. Update this README if SLO targets change
4. Commit with message: `perf: update SLO baselines after [change]`

## Current Measured Baselines

See `baselines.json` for current measured values. Values of `0` indicate the
baseline has not yet been measured for that metric.

Run the following to collect baselines:

```bash
# Against local Docker Compose environment
k6 run performance/k6/scenarios/baseline.js

# Against staging environment
BASE_URL=https://staging.bodam.io k6 run performance/k6/scenarios/baseline.js
```
