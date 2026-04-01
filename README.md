# pdf-microservice

HTML-to-PDF generation service built on Fastify 5, headless Chromium (Puppeteer), and AWS S3. Runs as a Docker container locally and as an AWS Lambda container image in production — same image, same binary.

## How it works

1. Client POSTs HTML to `POST /pdf/generate`
2. Puppeteer renders the HTML in a headless Chromium instance and exports a PDF
3. The PDF is uploaded to S3 and a presigned `GetObject` URL (default 1h TTL) is returned
4. Optionally, set `"stream": true` to receive the raw PDF bytes directly

The Chromium browser is launched once at startup and reused across requests. On Lambda, the process is frozen between invocations — the browser survives the freeze, so subsequent invocations pay no cold-start cost for browser launch.

## API

### `GET /health`

Returns service liveness. Also responds to `HEAD /health` (no body).

**Response**

```json
{ "status": "ok" }
```

Use this as the target for load balancer health checks or Lambda function URL probes.

---

### `GET /metrics`

Returns Prometheus-format metrics for the PDF generation service.

**Response**

```
Content-Type: text/plain; version=0.0.4; charset=utf-8

# HELP pdf_generation_duration_ms Duration of PDF generation in milliseconds
# TYPE pdf_generation_duration_ms histogram
pdf_generation_duration_ms_bucket{le="100"} 0
...
# HELP pdf_size_bytes Size of generated PDF in bytes
# TYPE pdf_size_bytes histogram
...
# HELP pdf_generation_requests_total Total number of PDF generation requests
# TYPE pdf_generation_requests_total counter
pdf_generation_requests_total{status="success"} 42
pdf_generation_requests_total{status="error"} 1
```

| Metric | Type | Description |
|---|---|---|
| `pdf_generation_duration_ms` | histogram | PDF generation wall-clock time; buckets at 100, 250, 500, 1000, 2500, 5000, 10000 ms |
| `pdf_size_bytes` | histogram | Generated PDF file size; buckets at 10 KB, 50 KB, 100 KB, 500 KB, 1 MB, 5 MB, 10 MB |
| `pdf_generation_requests_total` | counter | Request count labelled by `status="success"` or `status="error"` |

Metrics are in-memory and reset on process restart. Scrape with Prometheus or any compatible collector.

---

### `POST /pdf/generate`

**Request**

```json
{
  "html": "<html><body><h1>Hello</h1></body></html>",
  "css": "body { font-family: Arial, sans-serif; }",
  "paper": {
    "size": "A4",
    "orientation": "portrait"
  },
  "options": {
    "margin": { "top": "20mm", "right": "15mm", "bottom": "20mm", "left": "15mm" },
    "scale": 1.0,
    "printBackground": false,
    "headerTemplate": "<div style=\"font-size:10px;text-align:center;\">My Header</div>",
    "footerTemplate": "<div style=\"font-size:10px;text-align:right;\">Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></div>"
  },
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `html` | string | yes | HTML to render |
| `css` | string | no | Extra CSS injected into the page after the HTML is set |
| `paper.size` | string | no | `A4`, `A3`, `Letter`, `Legal`, `Tabloid` |
| `paper.orientation` | string | no | `portrait` or `landscape` |
| `options.margin` | object | no | `top`, `right`, `bottom`, `left` in CSS units |
| `options.scale` | number | no | 0.1–2.0 |
| `options.printBackground` | boolean | no | Include CSS backgrounds (default `false`) |
| `options.headerTemplate` | string | no | HTML template for the page header; enables `displayHeaderFooter` automatically |
| `options.footerTemplate` | string | no | HTML template for the page footer; supports `<span class="pageNumber">` and `<span class="totalPages">` |
| `stream` | boolean | no | `true` = binary response, `false` = S3 URL (default) |

**Response — S3 URL (`stream: false`)**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response — binary stream (`stream: true`)**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="document.pdf"
<binary PDF bytes>
```

---

### `GET /pdf/:id`

Returns a fresh presigned `GetObject` URL for a previously generated PDF.

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID (path) | The UUID returned at generation time |

**Response**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

The TTL of the returned URL is controlled by `SIGNED_URL_EXPIRY_SECONDS` (default 1 h). The PDF is stored under the key `pdfs/{id}.pdf`.

---

### `DELETE /pdf/:id`

Permanently deletes a PDF from S3.

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID (path) | The UUID of the PDF to delete |

**Response**

```
HTTP 204 No Content
```

---

### `POST /pdf/merge`

Merges two or more existing PDFs (by their IDs) into a single document in page order.

**Request**

```json
{
  "ids": ["550e8400-e29b-41d4-a716-446655440000", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"],
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `ids` | UUID[] | yes | Ordered list of PDF IDs to merge (minimum 2) |
| `stream` | boolean | no | `true` = binary response, `false` = S3 URL (default) |

**Response — S3 URL (`stream: false`)**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response — binary stream (`stream: true`)**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="merged.pdf"
<binary PDF bytes>
```

---

### `POST /pdf/split`

Extracts a subset of pages from an existing PDF.

**Request**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pages": "1-3,5,7-",
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Source PDF ID |
| `pages` | string | yes | Page range: `"1-3"` (range), `"1,3,5"` (list), `"2-"` (from page 2 to end) |
| `stream` | boolean | no | `true` = binary response, `false` = S3 URL (default) |

**Response — S3 URL (`stream: false`)**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response — binary stream (`stream: true`)**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="split.pdf"
<binary PDF bytes>
```

---

### `POST /pdf/compress`

Reduces the file size of an existing PDF. Uses Ghostscript when `GHOSTSCRIPT_PATH` is set (re-encodes images and streams); otherwise falls back to re-saving with `pdf-lib` object streams (reduces xref table size for text-heavy documents).

**Request**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Source PDF ID |
| `stream` | boolean | no | `true` = binary response, `false` = S3 URL (default) |

**Response — S3 URL (`stream: false`)**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response — binary stream (`stream: true`)**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="compressed.pdf"
<binary PDF bytes>
```

---

### `POST /pdf/pdfa`

Converts an existing PDF to PDF/A for long-term archival compliance. **Requires `GHOSTSCRIPT_PATH` to be set** — the route is not registered otherwise.

**Request**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "conformance": "2b",
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Source PDF ID |
| `conformance` | `"1b"` \| `"2b"` \| `"3b"` | no | PDF/A conformance level (default `"2b"`) |
| `stream` | boolean | no | `true` = binary response, `false` = S3 URL (default) |

**Response — S3 URL (`stream: false`)**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response — binary stream (`stream: true`)**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="pdfa.pdf"
<binary PDF bytes>
```

## Local development

Prerequisites: Docker and Docker Compose.

```bash
# Copy and edit environment variables
cp .env.example .env

# Start the API and a local MinIO (S3 replacement)
docker compose up

# The API is now available at http://localhost:8080
curl -s -X POST http://localhost:8080/pdf/generate \
  -H "Content-Type: application/json" \
  -d '{"html": "<html><body><h1>Hello</h1></body></html>"}' | jq .
```

The MinIO console is available at [http://localhost:9001](http://localhost:9001) (user: `minioadmin`, password: `minioadmin`).

Presigned URLs in the response use `http://localhost:9000` so they are directly openable from the host machine.

## Development without Docker

```bash
npm install

# Requires real AWS credentials and S3_BUCKET set in your environment
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with file watching (requires env vars set) |
| `npm test` | Run all tests (no real browser or S3 needed) |
| `npm run test:cov` | Run tests with coverage report |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run lint` | ESLint |
| `npm run build` | Bundle with esbuild to `dist/` |

## Authentication

All routes can be protected with a static API key passed in the `X-Api-Key` request header.

- Set the `API_KEY` environment variable (minimum 32 characters) to enable authentication.
- When `API_KEY` is not set, authentication is skipped (useful for local development).
- Unauthenticated requests receive a `401 Unauthorized` response before reaching any handler.
- Key comparison uses constant-time (`crypto.timingSafeEqual`) to prevent timing attacks.

```bash
# Example authenticated request
curl -X POST http://localhost:8080/pdf/generate \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-secret-key-here" \
  -d '{"html": "<html><body><h1>Hello</h1></body></html>"}'
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | yes | S3 bucket name for PDF storage |
| `AWS_REGION` | yes | AWS region |
| `AWS_ACCESS_KEY_ID` | prod only | IAM credentials (not needed with Lambda execution role) |
| `AWS_SECRET_ACCESS_KEY` | prod only | IAM credentials |
| `AWS_ENDPOINT_URL` | local only | Internal S3/MinIO endpoint — e.g. `http://minio:9000` |
| `AWS_PUBLIC_ENDPOINT_URL` | local only | Public-facing S3/MinIO endpoint for presigned URLs — e.g. `http://localhost:9000` |
| `SIGNED_URL_EXPIRY_SECONDS` | no | Presigned URL TTL, default `3600` |
| `LOG_LEVEL` | no | `trace` `debug` `info` `warn` `error` — default `info` |
| `PORT` | no | HTTP port for local server, default `8080` |
| `API_KEY` | recommended in prod | Static API key for request authentication (min 32 chars). Omit to disable auth. |
| `GHOSTSCRIPT_PATH` | no | Path to the `gs` binary. Enables real image compression on `POST /pdf/compress` and activates the `POST /pdf/pdfa` route. |

See [.env.example](.env.example) for a ready-to-copy template.

### `AWS_ENDPOINT_URL` vs `AWS_PUBLIC_ENDPOINT_URL`

Two S3 clients are registered:

- **`s3`** — uses `AWS_ENDPOINT_URL` for uploads. Resolves to the internal Docker network name (`minio`) so the API container can reach MinIO.
- **`s3Public`** — uses `AWS_PUBLIC_ENDPOINT_URL` for generating presigned URLs. Resolves to `localhost` so the returned URL is reachable from outside Docker.

In production with real S3 neither variable is set and both clients use the default AWS endpoint.

## Project structure

```
src/
  server.ts              # Fastify app factory — no listen(), shared by local + Lambda
  local.ts               # Docker / plain Node entry point (listen on 0.0.0.0:PORT)
  lambda.ts              # Lambda handler — buildApp() at module level for browser reuse
  config/env.ts          # Zod-parsed process.env — exits on missing required vars
  plugins/
    auth.ts              # API key authentication (X-Api-Key header, timing-safe comparison)
    s3.ts                # Registers s3 (upload) and s3Public (presigning) decorators
    sensible.ts          # @fastify/sensible (httpErrors, assert)
  routes/
    health/
      handler.ts         # GET /health → { status: "ok" }
      index.ts           # Route registration (GET /health)
    metrics/
      index.ts           # Route registration (GET /metrics)
    pdf/
      schema.ts          # Zod schema → JSON Schema for AJV validation
      handler.ts         # Orchestration: generate PDF → stream or upload to S3
      index.ts           # Route registration (POST /pdf/generate)
  services/
    pdf/PdfService.ts               # Puppeteer browser lifecycle + PDF generation
    pdf/PdfOperationsService.ts     # split (pdf-lib), compress + PDF/A (Ghostscript / pdf-lib fallback)
    storage/StorageService.ts       # S3 upload (s3) + presigned URL (s3Public)
    metrics/MetricsService.ts       # In-memory Prometheus metrics (histograms + counters)
  types/
    index.ts                   # Shared TypeScript interfaces
    aws-lambda-fastify.d.ts    # Ambient type declaration for aws-lambda-fastify

test/integration/
  generate.test.ts       # Full route tests via app.inject() — no real browser
  metrics.test.ts        # GET /metrics — verifies histogram/counter output after a generation
```

## Stack

| Layer | Package | Version |
|---|---|---|
| Framework | Fastify | 5.x |
| PDF rendering | puppeteer-core + @sparticuz/chromium | 24.x / 143.x |
| PDF merging | pdf-lib | 1.x |
| Validation | Zod | 4.x |
| Storage | @aws-sdk/client-s3 | 3.x |
| Logging | Pino (Fastify built-in) + pino-pretty | — |
| Testing | Vitest | 4.x |
| Build | esbuild | 0.27.x |
| Runtime | Node.js | 24 |

## Deployment

### Lambda (default)

The service deploys as a container image to AWS Lambda via GitHub Actions.

**On every PR:** typecheck → lint → tests → Docker build check (parallel)

**On merge to `main`:** build image → push to ECR → `aws lambda update-function-code` → smoke test

Required GitHub secrets: `AWS_ACCOUNT_ID`, `ECR_REPOSITORY`, `LAMBDA_FUNCTION_NAME`, `API_GATEWAY_URL`.

Authentication uses GitHub Actions OIDC → AWS STS (no long-lived IAM keys stored as secrets).

#### Recommended Lambda configuration

| Setting | Value |
|---|---|
| Memory | 2048 MB |
| Timeout | 30s |
| Ephemeral storage | 1024 MB |
| Architecture | x86_64 |
| Package type | Image |

