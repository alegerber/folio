#!/usr/bin/env bash
# smoke-test.sh — end-to-end test of all PDF microservice routes
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default BASE_URL: http://localhost:8080

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

echo "=== PDF Microservice Smoke Test ==="
echo "Base URL: $BASE"
echo ""

# ── GET /health ───────────────────────────────────────────────────────────────

echo "--- GET /health ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
assert_eq "HTTP 200" "200" "$STATUS"

BODY=$(curl -s "$BASE/health")
assert_contains "body contains status:ok" '"status":"ok"' "$BODY"

echo ""

# ── GET /metrics (baseline) ───────────────────────────────────────────────────

echo "--- GET /metrics ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/metrics")
assert_eq "HTTP 200" "200" "$STATUS"

METRICS=$(curl -s "$BASE/metrics")
assert_contains "duration histogram present" "pdf_generation_duration_ms_bucket" "$METRICS"
assert_contains "size histogram present"     "pdf_size_bytes_bucket"             "$METRICS"
assert_contains "requests counter present"   "pdf_generation_requests_total"     "$METRICS"

echo ""

# ── POST /pdf/generate → S3 URL ───────────────────────────────────────────────

echo "--- POST /pdf/generate (stream: false) ---"
RESP=$(curl -s -X POST "$BASE/pdf/generate" \
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

URL1=$(echo "$RESP" | sed 's/.*"url":"\([^"]*\)".*/\1/')
ID1=$(extract_id "$URL1")
echo "    ID 1: $ID1"

echo ""

# ── POST /pdf/generate (stream: true) ────────────────────────────────────────

echo "--- POST /pdf/generate (stream: true) ---"
TMP_PDF=$(mktemp /tmp/smoke-test-XXXXXX.pdf)
HTTP_CODE=$(curl -s -X POST "$BASE/pdf/generate" \
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
  -H "Content-Type: application/json" \
  -d '{"html": "<html><body><h1>Smoke Test Page 2</h1></body></html>"}')
URL2=$(echo "$RESP2" | sed 's/.*"url":"\([^"]*\)".*/\1/')
ID2=$(extract_id "$URL2")
assert_contains "second generate ok" '"statusCode":200' "$RESP2"
echo "    ID 2: $ID2"

echo ""

# ── GET /pdf/:id ──────────────────────────────────────────────────────────────

echo "--- GET /pdf/:id ---"
RESP=$(curl -s "$BASE/pdf/$ID1")
STATUS_CODE=$(echo "$RESP" | grep -o '"statusCode":[0-9]*' | grep -o '[0-9]*')
assert_eq "statusCode 200" "200" "$STATUS_CODE"
assert_contains "response contains url" '"url"' "$RESP"

echo ""

# ── GET /pdf/:id with invalid UUID ───────────────────────────────────────────

echo "--- GET /pdf/:id (invalid UUID → 400) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/pdf/not-a-uuid")
assert_eq "HTTP 400" "400" "$HTTP_CODE"

echo ""

# ── POST /pdf/merge → S3 URL ─────────────────────────────────────────────────

echo "--- POST /pdf/merge (stream: false) ---"
RESP=$(curl -s -X POST "$BASE/pdf/merge" \
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
  -H "Content-Type: application/json" \
  -d "{\"ids\": [\"$ID1\"]}")
assert_eq "HTTP 400" "400" "$HTTP_CODE"

echo ""

# ── DELETE /pdf/:id ───────────────────────────────────────────────────────────

echo "--- DELETE /pdf/:id ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/pdf/$ID1")
assert_eq "HTTP 204" "204" "$HTTP_CODE"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/pdf/$ID2")
assert_eq "HTTP 204 (second delete)" "204" "$HTTP_CODE"

echo ""

# ── GET /metrics (after requests) ────────────────────────────────────────────

echo "--- GET /metrics (after generation) ---"
METRICS=$(curl -s "$BASE/metrics")
assert_contains "success counter incremented" 'pdf_generation_requests_total{status="success"}' "$METRICS"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
