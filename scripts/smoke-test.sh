#!/usr/bin/env bash
# smoke-test.sh — end-to-end test of all PDF microservice routes
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default BASE_URL: http://localhost:8080
# Set API_KEY env var if the server requires authentication.

set -euo pipefail

BASE="${1:-http://localhost:8080}"
PASS=0
FAIL=0

# ── helpers ──────────────────────────────────────────────────────────────────

green() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
red()   { printf '\033[31m✗ %s\033[0m\n' "$*"; }

ok() {
  green "$1"
  PASS=$((PASS + 1))
}

fail() {
  red "$1"
  FAIL=$((FAIL + 1))
}

# assert_eq LABEL expected actual
assert_eq() {
  if [ "$2" = "$3" ]; then
    ok "$1 (got: $3)"
  else
    fail "$1 (expected: $2, got: $3)"
  fi
}

# assert_contains LABEL needle haystack
assert_contains() {
  if echo "$3" | grep -qF "$2"; then
    ok "$1"
  else
    fail "$1 (expected to contain: $2)"
    echo "    Response: $3"
  fi
}

# extract the UUID from a presigned S3/MinIO URL
# key format: pdfs/{uuid}.pdf
extract_id() {
  echo "$1" | sed 's|.*pdfs/\([^.]*\)\.pdf.*|\1|'
}

# extract a string field from a compact JSON response body
extract_json_string() {
  echo "$1" | sed -n "s|.*\"$2\":\"\\([^\"]*\\)\".*|\\1|p"
}

# Auth header args for curl — used as "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" 
# Must be an array; command substitution $(func) word-splits the header value.
AUTH_HEADER=()
if [ -n "${API_KEY:-}" ]; then
  AUTH_HEADER=(-H "x-api-key: $API_KEY")
fi

echo "=== PDF Microservice Smoke Test ==="
echo "Base URL: $BASE"
if [ -n "${API_KEY:-}" ]; then
  echo "Auth:     API key provided"
else
  echo "Auth:     none (set API_KEY to test authenticated endpoints)"
fi
echo ""

# ── GET /health ───────────────────────────────────────────────────────────────

echo "--- GET /health ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE/health")
assert_eq "HTTP 200" "200" "$STATUS"

BODY=$(curl -s "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE/health")
assert_contains "body contains status:ok" '"status":"ok"' "$BODY"

echo ""

# ── GET /metrics (baseline) ───────────────────────────────────────────────────

echo "--- GET /metrics ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE/metrics")
assert_eq "HTTP 200" "200" "$STATUS"

METRICS=$(curl -s "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE/metrics")
assert_contains "duration histogram present" "pdf_generation_duration_ms_bucket" "$METRICS"
assert_contains "size histogram present"     "pdf_size_bytes_bucket"             "$METRICS"
assert_contains "requests counter present"   "pdf_generation_requests_total"     "$METRICS"

echo ""

# ── Auth: 401 when API_KEY is configured and header is missing ────────────────

if [ -n "${API_KEY:-}" ]; then
  echo "--- Auth: missing x-api-key on GET /health → 401 ---"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
  assert_eq "HTTP 401 (health, no key)" "401" "$HTTP_CODE"

  echo "--- Auth: missing x-api-key on GET /metrics → 401 ---"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/metrics")
  assert_eq "HTTP 401 (metrics, no key)" "401" "$HTTP_CODE"

  echo "--- Auth: missing x-api-key → 401 ---"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/pdf/generate" \
    -H "Content-Type: application/json" \
    -d '{"html": "<h1>test</h1>"}')
  assert_eq "HTTP 401 (no key)" "401" "$HTTP_CODE"

  echo "--- Auth: wrong x-api-key → 401 ---"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/pdf/generate" \
    -H "Content-Type: application/json" \
    -H "x-api-key: wrong-key" \
    -d '{"html": "<h1>test</h1>"}')
  assert_eq "HTTP 401 (wrong key)" "401" "$HTTP_CODE"

  echo ""
fi

# ── POST /pdf/generate → S3 URL ───────────────────────────────────────────────

echo "--- POST /pdf/generate (stream: false) ---"
RESP=$(curl -s -X POST "$BASE/pdf/generate" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<html><body><h1>Smoke Test Page 1</h1></body></html>",
    "css": "body { font-family: Arial, sans-serif; }",
    "paper": { "size": "A4", "orientation": "portrait" },
    "options": { "margin": { "top": "15mm", "bottom": "15mm" } }
  }')

STATUS_CODE=$(echo "$RESP" | grep -o '"statusCode":[0-9]*' | grep -o '[0-9]*')
assert_eq "statusCode 200" "200" "$STATUS_CODE"
assert_contains "response contains url" '"url"' "$RESP"

ID1=$(extract_json_string "$RESP" id)
echo "    ID 1: $ID1"

echo ""

# ── POST /pdf/generate (stream: true) ────────────────────────────────────────

echo "--- POST /pdf/generate (stream: true) ---"
TMP_PDF=$(mktemp /tmp/smoke-test-XXXXXX.pdf)
HTTP_CODE=$(curl -s -X POST "$BASE/pdf/generate" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d '{"html": "<html><body><h1>Smoke Test Page 2</h1></body></html>", "stream": true}' \
  -o "$TMP_PDF" -w "%{http_code}")

assert_eq "HTTP 200" "200" "$HTTP_CODE"

# PDF files start with %PDF
MAGIC=$(head -c 4 "$TMP_PDF" 2>/dev/null || true)
if [ "$MAGIC" = "%PDF" ]; then
  ok "response is a valid PDF"
else
  fail "response is not a valid PDF (magic bytes: $MAGIC)"
fi
rm -f "$TMP_PDF"

echo ""

# Generate a second PDF for merge/delete tests
echo "--- POST /pdf/generate (second PDF for merge) ---"
RESP2=$(curl -s -X POST "$BASE/pdf/generate" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d '{"html": "<html><body><h1>Smoke Test Page 2</h1></body></html>"}')
ID2=$(extract_json_string "$RESP2" id)
assert_contains "second generate ok" '"statusCode":200' "$RESP2"
echo "    ID 2: $ID2"

echo ""

# ── GET /pdf/:id ──────────────────────────────────────────────────────────────

echo "--- GET /pdf/:id ---"
RESP=$(curl -s "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  "$BASE/pdf/$ID1")
STATUS_CODE=$(echo "$RESP" | grep -o '"statusCode":[0-9]*' | grep -o '[0-9]*')
assert_eq "statusCode 200" "200" "$STATUS_CODE"
assert_contains "response contains url" '"url"' "$RESP"

echo ""

# ── GET /pdf/:id with invalid UUID ───────────────────────────────────────────

echo "--- GET /pdf/:id (invalid UUID → 400) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  "$BASE/pdf/not-a-uuid")
assert_eq "HTTP 400" "400" "$HTTP_CODE"

echo ""

# ── POST /pdf/merge → S3 URL ─────────────────────────────────────────────────

echo "--- POST /pdf/merge (stream: false) ---"
RESP=$(curl -s -X POST "$BASE/pdf/merge" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"ids\": [\"$ID1\", \"$ID2\"]}")
STATUS_CODE=$(echo "$RESP" | grep -o '"statusCode":[0-9]*' | grep -o '[0-9]*')
assert_eq "statusCode 200" "200" "$STATUS_CODE"
assert_contains "response contains url" '"url"' "$RESP"

echo ""

# ── POST /pdf/merge → binary stream ──────────────────────────────────────────

echo "--- POST /pdf/merge (stream: true) ---"
TMP_MERGED=$(mktemp /tmp/smoke-test-merged-XXXXXX.pdf)
HTTP_CODE=$(curl -s -X POST "$BASE/pdf/merge" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"ids\": [\"$ID1\", \"$ID2\"], \"stream\": true}" \
  -o "$TMP_MERGED" -w "%{http_code}")
assert_eq "HTTP 200" "200" "$HTTP_CODE"

MAGIC=$(head -c 4 "$TMP_MERGED" 2>/dev/null || true)
if [ "$MAGIC" = "%PDF" ]; then
  ok "merged response is a valid PDF"
else
  fail "merged response is not a valid PDF (magic bytes: $MAGIC)"
fi
rm -f "$TMP_MERGED"

echo ""

# ── POST /pdf/merge with < 2 ids → 400 ───────────────────────────────────────

echo "--- POST /pdf/merge (< 2 ids → 400) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/pdf/merge" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"ids\": [\"$ID1\"]}")
assert_eq "HTTP 400" "400" "$HTTP_CODE"

echo ""

# ── POST /pdf/split → binary stream ──────────────────────────────────────────

echo "--- POST /pdf/split (stream: true) ---"
TMP_SPLIT=$(mktemp /tmp/smoke-test-split-XXXXXX.pdf)
HTTP_CODE=$(curl -s -X POST "$BASE/pdf/split" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$ID1\", \"pages\": \"1\", \"stream\": true}" \
  -o "$TMP_SPLIT" -w "%{http_code}")
assert_eq "HTTP 200" "200" "$HTTP_CODE"

MAGIC=$(head -c 4 "$TMP_SPLIT" 2>/dev/null || true)
if [ "$MAGIC" = "%PDF" ]; then
  ok "split response is a valid PDF"
else
  fail "split response is not a valid PDF (magic bytes: $MAGIC)"
fi
rm -f "$TMP_SPLIT"

echo ""

# ── POST /pdf/split → S3 URL ──────────────────────────────────────────────────

echo "--- POST /pdf/split (stream: false) ---"
RESP=$(curl -s -X POST "$BASE/pdf/split" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$ID1\", \"pages\": \"1\"}")
STATUS_CODE=$(echo "$RESP" | grep -o '"statusCode":[0-9]*' | grep -o '[0-9]*')
assert_eq "statusCode 200" "200" "$STATUS_CODE"
assert_contains "split response contains url" '"url"' "$RESP"

echo ""

# ── POST /pdf/split with missing pages field → 400 ───────────────────────────

echo "--- POST /pdf/split (missing pages → 400) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/pdf/split" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$ID1\"}")
assert_eq "HTTP 400" "400" "$HTTP_CODE"

echo ""

# ── POST /pdf/compress → binary stream ───────────────────────────────────────

echo "--- POST /pdf/compress (stream: true) ---"
TMP_COMPRESSED=$(mktemp /tmp/smoke-test-compressed-XXXXXX.pdf)
HTTP_CODE=$(curl -s -X POST "$BASE/pdf/compress" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$ID1\", \"stream\": true}" \
  -o "$TMP_COMPRESSED" -w "%{http_code}")
assert_eq "HTTP 200" "200" "$HTTP_CODE"

MAGIC=$(head -c 4 "$TMP_COMPRESSED" 2>/dev/null || true)
if [ "$MAGIC" = "%PDF" ]; then
  ok "compress response is a valid PDF"
else
  fail "compress response is not a valid PDF (magic bytes: $MAGIC)"
fi
rm -f "$TMP_COMPRESSED"

echo ""

# ── POST /pdf/pdfa (only when Ghostscript is available) ───────────────────────

if [ -n "${GHOSTSCRIPT_PATH:-}" ]; then
  echo "--- POST /pdf/pdfa (stream: true) ---"
  TMP_PDFA=$(mktemp /tmp/smoke-test-pdfa-XXXXXX.pdf)
  HTTP_CODE=$(curl -s -X POST "$BASE/pdf/pdfa" \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$ID1\", \"conformance\": \"2b\", \"stream\": true}" \
    -o "$TMP_PDFA" -w "%{http_code}")
  assert_eq "HTTP 200" "200" "$HTTP_CODE"

  MAGIC=$(head -c 4 "$TMP_PDFA" 2>/dev/null || true)
  if [ "$MAGIC" = "%PDF" ]; then
    ok "pdfa response is a valid PDF"
  else
    fail "pdfa response is not a valid PDF (magic bytes: $MAGIC)"
  fi
  rm -f "$TMP_PDFA"

  echo ""
else
  echo "--- POST /pdf/pdfa (skipped — GHOSTSCRIPT_PATH not set) ---"
  echo ""
fi

# ── DELETE /pdf/:id ───────────────────────────────────────────────────────────

echo "--- DELETE /pdf/:id ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  "$BASE/pdf/$ID1")
assert_eq "HTTP 204" "204" "$HTTP_CODE"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"  "$BASE/pdf/$ID2")
assert_eq "HTTP 204 (second delete)" "204" "$HTTP_CODE"

echo ""

# ── GET /metrics (after requests) ────────────────────────────────────────────

echo "--- GET /metrics (after generation) ---"
METRICS=$(curl -s "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE/metrics")
assert_contains "success counter incremented" 'pdf_generation_requests_total{status="success"}' "$METRICS"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
