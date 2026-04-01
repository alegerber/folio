# AGENTS.md — PDF Microservice

## Project Overview

Node.js PDF generation microservice built with Fastify 5, Puppeteer (headless Chromium), and AWS S3.
Runs as both a Docker container (local dev) and an AWS Lambda container image (production) — same image, same binary.

## Stack

| Layer | Package | Version |
|---|---|---|
| Framework | Fastify | 5.x |
| PDF | puppeteer-core + @sparticuz/chromium | 24.x / 143.x |
| Validation | Zod | 4.x |
| Storage | @aws-sdk/client-s3 | 3.x |
| Logging | Pino (Fastify built-in) + pino-pretty | — |
| Testing | Vitest | 4.x |
| Build | esbuild (CJS output) | 0.27.x |
| Runtime | Node.js | 24 |

## Architecture

```
src/
  server.ts              # Fastify app factory — no listen(), shared by local + Lambda
  local.ts               # Plain Node entry point — IIFE wrapping buildApp() + listen()
  lambda.ts              # Lambda handler — buildApp() called via promise at module level
  config/env.ts          # Zod-parsed process.env, process.exit(1) on missing required vars
  plugins/
    s3.ts                # Registers s3 (upload) + s3Public (presigning) as Fastify decorators
    sensible.ts          # @fastify/sensible
  routes/
    health/
      handler.ts         # GET /health → { status: "ok" }
      index.ts           # Registers GET /health
    metrics/
      index.ts           # Registers GET /metrics; injects MetricsService
    pdf/
      schema.ts          # Zod schema; z.toJSONSchema() with $schema stripped for AJV compat
      handler.ts         # generate PDF → stream bytes or upload to S3 + return presigned URL
      index.ts           # Registers POST /pdf/generate
  services/
    pdf/PdfService.ts          # Puppeteer browser lifecycle + PDF generation
    storage/StorageService.ts  # S3 upload (s3 client) + presigned URL (s3Public client)
    metrics/MetricsService.ts  # In-memory histograms + counter; serialises to Prometheus text
  types/
    index.ts                   # GenerateRequest, PaperOptions, PdfOptions, GenerateResponse
    aws-lambda-fastify.d.ts    # Ambient declaration for aws-lambda-fastify (no types shipped)
```

## API

### GET /health

Returns service liveness. Also responds to `HEAD /health`.

**Response:**
```json
{ "status": "ok" }
```

Use for load balancer health checks or Lambda function URL probes. No auth required.

**Files:** `src/routes/health/index.ts`, `src/routes/health/handler.ts`

---

### GET /metrics

Returns Prometheus text-format metrics (`text/plain; version=0.0.4`).

| Metric | Type | Buckets |
|---|---|---|
| `pdf_generation_duration_ms` | histogram | 100, 250, 500, 1000, 2500, 5000, 10000 ms |
| `pdf_size_bytes` | histogram | 10 KB, 50 KB, 100 KB, 500 KB, 1 MB, 5 MB, 10 MB |
| `pdf_generation_requests_total` | counter | labels: `status="success"`, `status="error"` |

Metrics are in-memory (reset on restart). `MetricsService` is instantiated in `server.ts`, passed to the PDF route handler (which calls `recordSuccess`/`recordError`), and injected into the metrics route.

**Files:** `src/routes/metrics/index.ts`, `src/services/metrics/MetricsService.ts`

---

### POST /pdf/generate

**Request body:**
```json
{
  "html": "<html>...</html>",
  "paper": { "size": "A4", "orientation": "portrait" },
  "options": {
    "margin": { "top": "10mm", "right": "10mm", "bottom": "10mm", "left": "10mm" },
    "scale": 1.0,
    "printBackground": false
  },
  "stream": false
}
```

**Response (`stream: false`):**
```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response (`stream: true`):**
- `Content-Type: application/pdf`
- Binary PDF bytes

## Key Decisions

1. **Browser reuse**: `PdfService` holds the `Browser` instance at class level. `lambda.ts` calls `buildApp()` outside the handler via a module-level promise — Lambda freezes the process between invocations, so the browser survives and is reused on warm calls.

2. **Two S3 clients**: `s3Plugin` registers both `fastify.s3` (internal endpoint for uploads) and `fastify.s3Public` (public endpoint for presigned URLs). This is needed locally so MinIO is reachable inside Docker via `http://minio:9000` for uploads, while presigned URLs use `http://localhost:9000` so they're openable from the host machine. In production with real S3 both clients use the default endpoint.

3. **No local filesystem**: PDF bytes go directly to S3 — required for Lambda where `/tmp` is ephemeral and not shared across containers.

4. **CJS bundle**: esbuild outputs CJS (`--format=cjs`). Pino and `@sparticuz/chromium` are marked `--external` because pino spawns transport worker threads that resolve modules by filesystem path (incompatible with bundling), and chromium ships native binaries.

5. **Zod v4 + AJV compat**: `z.toJSONSchema()` emits a `$schema: "https://json-schema.org/draft/2020-12/schema"` field. Fastify's AJV uses draft-07 and can't resolve that ref — it is stripped in `schema.ts` before passing to Fastify.

6. **`--no-sandbox`**: `@sparticuz/chromium` sets this automatically via its `args` export. Always use `chromium.args`, `chromium.executablePath()`, and `chromium.headless` when launching.

7. **`platform: linux/amd64`** in `docker-compose.yml`: `@sparticuz/chromium` ships only x86_64 binaries. On Apple Silicon, Docker must build/run under Rosetta 2 emulation.

## Development

```bash
# Install dependencies
npm install

# Start local dev server + MinIO via Docker Compose
docker compose up

# Run tests (no real browser or S3 needed — both are mocked)
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build CJS bundle to dist/
npm run build
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | yes | S3 bucket name |
| `AWS_REGION` | yes | AWS region |
| `AWS_ACCESS_KEY_ID` | prod only | IAM credentials |
| `AWS_SECRET_ACCESS_KEY` | prod only | IAM credentials |
| `AWS_ENDPOINT_URL` | local only | Internal MinIO endpoint — `http://minio:9000` |
| `AWS_PUBLIC_ENDPOINT_URL` | local only | Public MinIO endpoint for presigned URLs — `http://localhost:9000` |
| `SIGNED_URL_EXPIRY_SECONDS` | no | Default: `3600` |
| `LOG_LEVEL` | no | Default: `info` |
| `PORT` | no | Default: `8080` |

## Testing Strategy

- **Unit tests**: `PdfService` and `StorageService` are unit-tested with mocked dependencies (no real browser, no real S3). Vitest v4 requires constructor mocks to use `class` syntax — not arrow function implementations.
- **Integration tests**: `test/integration/generate.test.ts` and `test/integration/metrics.test.ts` use `app.inject()` — full Fastify route pipeline, no real browser or S3. The metrics test fires a `/pdf/generate` request and then asserts that counters and bucket values in `/metrics` reflect it.
- **No Chromium in CI**: Tests run with mocked Puppeteer, so CI doesn't need to install Chromium.

## Extension Plans

Planned features are documented in `.plans/`:

| File | Description |
|---|---|
| `headers-footers.md` | HTML header/footer templates on every PDF page |
| `css-injection.md` | Inject extra CSS before rendering |
| `url-rendering.md` | Render a URL instead of raw HTML (includes SSRF notes) |
| `async-webhook.md` | `202 Accepted` + webhook callback for slow jobs |
| `api-key-auth.md` | `X-Api-Key` header auth with timing-safe comparison |
| `observability.md` | `/metrics` + PDF generation histograms — **implemented** |
| `additional-routes.md` | `GET /pdf/:id`, `DELETE /pdf/:id`, `POST /pdf/merge` |
| `queue-based-scaling.md` | SQS / BullMQ decoupled worker tier |
| `node-server-deployment.md` | ECS Fargate / Fly.io plain Node server deployment |
