#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Monte Engine E2E Smoke Test"
echo "================================"

if command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
elif docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
else
  echo "❌ docker compose not found"
  exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "❌ docker not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ node not found"; exit 1; }

if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${GROQ_API_KEY:-}" && -z "${LLM_API_KEY:-}" ]]; then
  echo "❌ No LLM API key found. Set OPENROUTER_API_KEY, GROQ_API_KEY, or LLM_API_KEY"
  exit 1
fi

if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${EMBEDDING_API_KEY:-}" ]]; then
  echo "❌ No embedding API key found. Set OPENROUTER_API_KEY or EMBEDDING_API_KEY"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_LOG="/tmp/monte-e2e-server.log"
REPORT_PATH="/tmp/monte-e2e-report.md"
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
  "${DOCKER_COMPOSE[@]}" down >/dev/null 2>&1 || true
}

trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "❌ Timed out waiting for $label"
  if [[ -f "$SERVER_LOG" ]]; then
    tail -n 50 "$SERVER_LOG"
  fi
  exit 1
}

wait_for_persona_ready() {
  for ((i=1; i<=90; i++)); do
    local output
    output="$(npm run cli:dev -- persona status 2>&1 || true)"
    printf '%s\n' "$output"

    if grep -qi "ready" <<<"$output"; then
      return 0
    fi

    if grep -qi "failed" <<<"$output"; then
      echo "❌ Persona build failed"
      exit 1
    fi

    sleep 2
  done

  echo "❌ Timed out waiting for persona build"
  exit 1
}

echo
echo "Step 1: Starting infrastructure..."
"${DOCKER_COMPOSE[@]}" up -d neo4j redis minio
wait_for_url "http://localhost:9000/minio/health/live" "MinIO"
sleep 5

echo
echo "Step 2: Starting API server..."
: > "$SERVER_LOG"
npx tsx "$ROOT_DIR/src/index.ts" >"$SERVER_LOG" 2>&1 &
API_PID=$!
wait_for_url "http://localhost:3000/health" "API server"

echo
echo "Step 3: Running health check..."
npm run cli:dev -- doctor

echo
echo "Step 4: Ingesting test data..."
npm run cli:dev -- ingest "$ROOT_DIR/tests/e2e/fixtures/sample-data"
sleep 10

echo
echo "Step 5: Building persona..."
npm run cli:dev -- persona build

echo
echo "Step 6: Waiting for persona readiness..."
wait_for_persona_ready

echo
echo "Step 7: Running simulation..."
SIM_OUTPUT="$(npm run cli:dev -- simulate "should I start freelancing?" --clones 100 --wait)"
printf '%s\n' "$SIM_OUTPUT"
SIM_ID="$(grep "Simulation ID:" <<<"$SIM_OUTPUT" | awk '{print $NF}' | tail -n 1)"

if [[ -z "$SIM_ID" ]]; then
  echo "❌ Failed to capture Simulation ID"
  exit 1
fi

echo
echo "Step 8: Generating report..."
rm -f "$REPORT_PATH"
npm run cli:dev -- report "$SIM_ID" -o "$REPORT_PATH"

grep -q "## Executive Summary" "$REPORT_PATH" || { echo "❌ Report missing executive summary"; exit 1; }
grep -q "## Outcome Distribution" "$REPORT_PATH" || { echo "❌ Report missing outcome distribution"; exit 1; }

echo
echo "✅ Smoke test passed!"
