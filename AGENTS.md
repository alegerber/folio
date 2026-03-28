# AGENTS.md — PDF Microservice

## Project Overview

Node.js PDF generation microservice built with Fastify 4, Puppeteer (headless Chrome), and AWS S3.
Runs as both a Docker container (for local dev) and an AWS Lambda function (production).

## Architecture

- **Entry points**: `src/local.ts` (Docker/local), `src/lambda.ts` (Lambda)
- **App factory**: `src/server.ts` — `buildApp()` registers all plugins and routes
- **PDF generation**: `src/services/pdf/PdfService.ts` — wraps Puppeteer browser lifecycle
- **Storage**: `src/services/storage/StorageService.ts` — S3 upload + presigned URL generation
- **Route**: `POST /pdf/generate` — defined in `src/routes/pdf/`
- **Config**: `src/config/env.ts` — Zod-validated environment variables, fails fast on missing

## API

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

**Response (stream: false):**
```json
{ "statusCode": 200, "data": { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=..." } }
```

**Response (stream: true):**
- `Content-Type: application/pdf`
- Binary PDF bytes

## Development

```bash
# Install dependencies
npm install

# Start local dev server (requires MinIO running)
docker compose up

# Run tests (no real browser needed — PdfService is mocked)
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | yes | S3 bucket name |
| `AWS_REGION` | yes | AWS region |
| `AWS_ACCESS_KEY_ID` | prod | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | prod | IAM secret key |
| `AWS_ENDPOINT_URL` | local | MinIO endpoint (e.g. `http://minio:9000`) |
| `SIGNED_URL_EXPIRY_SECONDS` | no | Default: 3600 |
| `LOG_LEVEL` | no | Default: `info` |

## Key Decisions

1. **Browser reuse**: `PdfService` holds `Browser` at instance level. Lambda keeps module-level instance alive between warm invocations.
2. **No local filesystem**: PDF bytes go directly to S3 — works on Lambda where `/tmp` is not shared across containers.
3. **MinIO for local dev**: Drop-in S3 replacement via `AWS_ENDPOINT_URL` + `forcePathStyle: true`.
4. **Single source of truth for schema**: Zod schema in `src/routes/pdf/schema.ts` is converted to JSON Schema for AJV validation.
5. **`--no-sandbox`**: `@sparticuz/chromium` sets this automatically via its `args` export.

## Testing Strategy

- **Unit tests**: `PdfService` and `StorageService` are unit-tested with mocked dependencies (no real browser, no real S3).
- **Integration tests**: `test/integration/generate.test.ts` uses `app.inject()` — full route pipeline without a real browser.
- **No Chromium in CI**: Tests run with mocked Puppeteer, so CI doesn't need to install Chromium.
