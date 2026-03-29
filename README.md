# pdf-microservice

HTML-to-PDF generation service built on Fastify 4, headless Chromium (Puppeteer), and AWS S3. Runs as a Docker container locally and as an AWS Lambda container image in production — same image, same binary.

## How it works

1. Client POSTs HTML to `POST /pdf/generate`
2. Puppeteer renders the HTML in a headless Chromium instance and exports a PDF
3. The PDF is uploaded to S3 and a presigned `GetObject` URL (default 1h TTL) is returned
4. Optionally, set `"stream": true` to receive the raw PDF bytes directly

The Chromium browser is launched once at startup and reused across requests. On Lambda, the process is frozen between invocations — the browser survives the freeze, so subsequent invocations pay no cold-start cost for browser launch.

## API

### `POST /pdf/generate`

**Request**

```json
{
  "html": "<html><body><h1>Hello</h1></body></html>",
  "paper": {
    "size": "A4",
    "orientation": "portrait"
  },
  "options": {
    "margin": { "top": "20mm", "right": "15mm", "bottom": "20mm", "left": "15mm" },
    "scale": 1.0,
    "printBackground": false
  },
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `html` | string | yes | HTML to render |
| `paper.size` | string | no | `A4`, `A3`, `Letter`, `Legal`, `Tabloid` |
| `paper.orientation` | string | no | `portrait` or `landscape` |
| `options.margin` | object | no | `top`, `right`, `bottom`, `left` in CSS units |
| `options.scale` | number | no | 0.1–2.0 |
| `options.printBackground` | boolean | no | Include CSS backgrounds (default `false`) |
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

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | yes | S3 bucket name for PDF storage |
| `AWS_REGION` | yes | AWS region |
| `AWS_ACCESS_KEY_ID` | prod only | IAM credentials (not needed with Lambda execution role) |
| `AWS_SECRET_ACCESS_KEY` | prod only | IAM credentials |
| `AWS_ENDPOINT_URL` | local only | MinIO endpoint — e.g. `http://minio:9000` |
| `SIGNED_URL_EXPIRY_SECONDS` | no | Presigned URL TTL, default `3600` |
| `LOG_LEVEL` | no | `trace` `debug` `info` `warn` `error` — default `info` |

See [.env.example](.env.example) for a ready-to-copy template.

## Project structure

```
src/
  server.ts              # Fastify app factory — no listen(), shared by local + Lambda
  local.ts               # Docker entry point (listen on 0.0.0.0:8080)
  lambda.ts              # Lambda handler (aws-lambda-fastify wrapper)
  config/env.ts          # Zod-parsed process.env — exits on missing required vars
  plugins/
    s3.ts                # S3Client registered as Fastify decorator
    sensible.ts          # @fastify/sensible (httpErrors, assert)
  routes/pdf/
    schema.ts            # Zod schema → JSON Schema for AJV validation
    handler.ts           # Orchestration: generate PDF → stream or upload to S3
    index.ts             # Route registration (POST /pdf/generate)
  services/
    pdf/PdfService.ts          # Puppeteer browser lifecycle + PDF generation
    storage/StorageService.ts  # S3 upload + presigned URL generation
  types/index.ts         # Shared TypeScript interfaces

test/integration/
  generate.test.ts       # Full route tests via app.inject() — no real browser
```

## Deployment

The service deploys as a container image to AWS Lambda via GitHub Actions.

**On every PR:** typecheck → lint → tests → Docker build check (parallel)

**On merge to `main`:** build image → push to ECR → `aws lambda update-function-code` → smoke test

Required GitHub secrets: `AWS_ACCOUNT_ID`, `ECR_REPOSITORY`, `LAMBDA_FUNCTION_NAME`, `API_GATEWAY_URL`.

Authentication uses GitHub Actions OIDC → AWS STS (no long-lived IAM keys stored as secrets).

### Recommended Lambda configuration

| Setting | Value |
|---|---|
| Memory | 2048 MB |
| Timeout | 30s |
| Ephemeral storage | 1024 MB |
| Architecture | x86_64 |
| Package type | Image |
