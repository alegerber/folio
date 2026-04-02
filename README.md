# folio

Serverless-native PDF API. HTML → PDF on AWS Lambda, S3-first. TypeScript, Fastify, headless Chromium.

The same container image runs on **AWS Lambda** or plain **Docker** without modification. PDF bytes go straight to S3 — no shared filesystem, no ephemeral `/tmp` issues.

> Looking for a self-hosted Docker-only solution? Check out [Gotenberg](https://gotenberg.dev/).
> Folio is built for teams already on AWS who want a PDF service that fits their existing infrastructure.

---

## What makes folio different

| | folio | Gotenberg |
|---|---|---|
| AWS Lambda support | ✅ | ❌ |
| S3 upload + presigned URL | ✅ | ❌ |
| API key auth | ✅ | ❌ |
| OpenAPI docs | Planned | ❌ |
| HTML → PDF | ✅ | ✅ |
| URL → PDF | Planned | ✅ |
| Screenshot (PNG/JPEG) | Planned | ✅ |
| DOCX / XLSX → PDF | Planned (Docker only) | ✅ |
| PDF merge | ✅ | ✅ |
| PDF split / compress | Planned | ✅ |
| Prometheus metrics | ✅ | ✅ |
| Language | TypeScript | Go |

---

## Quick start

```bash
# Copy and edit environment variables
cp .env.example .env

# Start API + MinIO (local S3)
docker compose up

# Generate a PDF
curl -s -X POST http://localhost:8080/pdf/generate \
  -H "Content-Type: application/json" \
  -d '{"html": "<html><body><h1>Hello</h1></body></html>"}' | jq .
```

The MinIO console is at [http://localhost:9001](http://localhost:9001) (user: `minioadmin`, password: `minioadmin`).

Presigned URLs in the response use `http://localhost:9000` and are directly openable from the host.

---

## API

When `API_KEY` is set, every endpoint requires the `X-Api-Key` header, including `/health` and `/metrics`.

### `GET /health`

Returns service liveness. Also responds to `HEAD /health`.

```json
{ "status": "ok" }
```

---

### `GET /metrics`

Prometheus text-format metrics.

| Metric | Type | Description |
|---|---|---|
| `pdf_generation_duration_ms` | histogram | Wall-clock time; buckets at 100–10000 ms |
| `pdf_size_bytes` | histogram | Output size; buckets at 10 KB–10 MB |
| `pdf_generation_requests_total` | counter | Labelled `status="success"` / `status="error"` |

---

### `POST /pdf/generate`

Render HTML to PDF with headless Chromium.

**Request**

```json
{
  "html": "<html><body><h1>Hello</h1></body></html>",
  "css": "body { font-family: Arial, sans-serif; }",
  "paper": { "size": "A4", "orientation": "portrait" },
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
| `css` | string | no | Extra CSS injected after HTML is set |
| `paper.size` | string | no | `A4`, `A3`, `Letter`, `Legal`, `Tabloid` |
| `paper.orientation` | string | no | `portrait` or `landscape` |
| `options.margin` | object | no | `top`, `right`, `bottom`, `left` in CSS units |
| `options.scale` | number | no | 0.1–2.0 |
| `options.printBackground` | boolean | no | Include CSS backgrounds (default `false`) |
| `options.headerTemplate` | string | no | HTML header displayed on every page |
| `options.footerTemplate` | string | no | HTML footer; supports `<span class="pageNumber">` and `<span class="totalPages">` |
| `stream` | boolean | no | `true` = binary PDF, `false` = S3 presigned URL (default) |

**Response — S3 URL**

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response — binary stream**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="document.pdf"
```

---

### `GET /pdf/:id`

Returns a fresh presigned URL for a previously generated PDF. The `id` is the UUID returned at generation time.

```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

---

### `DELETE /pdf/:id`

Permanently deletes a PDF from S3.

```
HTTP 204 No Content
```

---

### `POST /pdf/merge`

Merge two or more existing PDFs (by their IDs) into one document.

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

---

## Authentication

All routes can be protected with a static API key passed in the `X-Api-Key` header.

- Set `API_KEY` (minimum 32 characters) to enable authentication.
- When `API_KEY` is not set, auth is skipped (useful for local dev).
- Key comparison uses `crypto.timingSafeEqual` to prevent timing attacks.

```bash
curl -X POST http://localhost:8080/pdf/generate \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-secret-key-here" \
  -d '{"html": "<html><body><h1>Hello</h1></body></html>"}'
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | yes | S3 bucket name |
| `AWS_REGION` | yes | AWS region |
| `AWS_ACCESS_KEY_ID` | prod only | IAM credentials (not needed with Lambda execution role) |
| `AWS_SECRET_ACCESS_KEY` | prod only | IAM credentials |
| `AWS_ENDPOINT_URL` | local only | Internal S3/MinIO endpoint — `http://minio:9000` |
| `AWS_PUBLIC_ENDPOINT_URL` | local only | Public-facing endpoint for presigned URLs — `http://localhost:9000` |
| `SIGNED_URL_EXPIRY_SECONDS` | no | Presigned URL TTL, default `3600` |
| `LOG_LEVEL` | no | `trace` `debug` `info` `warn` `error` — default `info` |
| `PORT` | no | HTTP port for local server, default `8080` |
| `API_KEY` | recommended in prod | Static API key for request authentication (min 32 chars). Omit to disable auth. |
| `GHOSTSCRIPT_PATH` | no | Path to the `gs` binary. Enables real image compression on `POST /pdf/compress` and activates the `POST /pdf/pdfa` route. |

See [.env.example](.env.example) for a ready-to-copy template.

---

## Development

```bash
npm install

# Run tests (no real browser or S3 — both are mocked)
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build CJS bundle to dist/
npm run build

# Start with file watching (requires env vars)
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with file watching |
| `npm test` | Run all tests |
| `npm run test:cov` | Tests with coverage |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |
| `npm run build` | Bundle with esbuild to `dist/` |

---

## Project structure

```
src/
  server.ts              # Fastify app factory — shared by local + Lambda
  local.ts               # Docker / plain Node entry point
  lambda.ts              # Lambda handler — buildApp() at module level for browser reuse
  config/env.ts          # Zod-parsed process.env — exits on missing required vars
  plugins/
    auth.ts              # API key authentication (X-Api-Key, timing-safe)
    s3.ts                # s3 (upload) + s3Public (presigning) decorators
    sensible.ts          # @fastify/sensible
  routes/
    health/              # GET /health
    metrics/             # GET /metrics
    pdf/                 # POST /pdf/generate, GET /pdf/:id, DELETE /pdf/:id, POST /pdf/merge
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
  metrics.test.ts        # Metrics endpoint after a generation request
```

---

## Deployment

### Lambda (default)

Deploys as a container image to AWS Lambda via GitHub Actions.

- **Every PR:** typecheck → lint → tests → Docker build check (parallel)
- **Merge to `main`:** `sam build` → `sam deploy` → smoke test

Auth uses GitHub Actions OIDC → AWS STS. Required secrets: `AWS_ACCOUNT_ID`, `ECR_REPOSITORY`, `S3_BUCKET_NAME`, `SAM_ARTIFACT_BUCKET`, `API_KEY`.
The SAM template resolves the runtime API key from the SSM SecureString parameter `/folio/api-key`, so the deploy role also needs `ssm:GetParameter` / `ssm:GetParameters` and that parameter must exist before CI deploys.
`./scripts/aws-setup.sh` bootstraps the OIDC provider, deploy role, buckets, ECR repository, and `/folio/api-key`.

If deploys fail with `DELETE_FAILED`, the existing CloudFormation stack must be cleaned up before `sam deploy` can update it:

```bash
aws cloudformation describe-stack-events --stack-name folio --region eu-central-1
aws cloudformation delete-stack --stack-name folio --region eu-central-1
```

If deletion fails again, inspect the event log for the specific resource blocking cleanup.

**Recommended Lambda configuration**

| Setting | Value |
|---|---|
| Memory | 2048 MB |
| Timeout | 120 s |
| Architecture | x86_64 |
| Package type | Image |

### Docker / ECS / Fly.io / Railway

Build the `server` stage and run anywhere Docker is supported:

```bash
docker build --target server -t pdf-microservice .
docker run -p 8080:8080 --env-file .env pdf-microservice
```

---

## Roadmap

See [`.plans/PLAN.md`](.plans/PLAN.md) for the full feature roadmap and Gotenberg comparison.

Planned features (in order): URL rendering → Screenshot API → OpenAPI docs → LibreOffice conversion → PDF split/compress/PDF/A → Async webhooks → Queue-based scaling → Open-source publishing (GHCR image, release automation).

---

## Stack

| Layer | Package | Version |
|---|---|---|
| Framework | Fastify | 5.x |
| PDF rendering | puppeteer-core + @sparticuz/chromium | 24.x / 143.x |
| PDF merging | pdf-lib | 1.x |
| Validation | Zod | 4.x |
| Storage | @aws-sdk/client-s3 | 3.x |
| Logging | Pino | — |
| Testing | Vitest | 4.x |
| Build | esbuild | 0.27.x |
| Runtime | Node.js | 24 |
