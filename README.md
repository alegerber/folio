# folio

[![License: MIT](https://img.shields.io/github/license/alegerber/folio)](LICENSE)

Serverless-native PDF API. HTML → PDF on AWS Lambda, S3-first. TypeScript, Fastify, headless Chromium.

The same container image runs on **AWS Lambda** or plain **Docker** without modification. PDF bytes go straight to S3 — no shared filesystem, no ephemeral `/tmp` issues.

Folio is built for teams already on AWS who want a PDF service that fits their existing infrastructure.

---

## What folio includes

- AWS Lambda and plain Docker support from the same container image
- S3 upload plus presigned URL responses
- API key authentication
- HTML to PDF generation with CSS, headers, and footers
- URL rendering — navigate to a URL and render the page as PDF (supports cookies and custom headers)
- PDF merge, split, compress, and PDF/A routes
- Prometheus-style metrics
- Planned screenshots, OpenAPI docs, and document conversion

---

## Quick start

```bash
# Copy and edit environment variables
cp .env.example .env

# Optional: local SAM deploy config
cp samconfig.example.toml samconfig.toml

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

## Documentation

The GitHub Pages site is published from [`docs/`](docs/) and includes the full API reference.

- [Documentation landing page](docs/index.html)
- [API reference](docs/api/index.html)
- [Contributing guide](CONTRIBUTING.md)
- [GitHub Pages workflow](.github/workflows/pages.yml)

## Container images

Prebuilt images are published to GitHub Container Registry from semver tags like `v1.2.3`.

```bash
docker pull ghcr.io/alegerber/folio:latest
docker pull ghcr.io/alegerber/folio:latest-full
```

Each release publishes `latest`, `x.y.z`, and `x.y` tags. Matching `-full` tags are also published so downstream deploys can adopt the long-lived tag shape now; they currently mirror the main image until the larger Docker-only conversion toolchain lands.

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
    pdf/                 # POST /pdf/generate, GET/DELETE /pdf/:id, POST /pdf/merge, /pdf/split, /pdf/compress, /pdf/pdfa
  services/
    pdf/PdfService.ts               # Puppeteer browser lifecycle + PDF generation
    pdf/PdfOperationsService.ts     # split (pdf-lib), compress + PDF/A (Ghostscript / pdf-lib fallback)
    storage/StorageService.ts       # S3 upload (s3) + presigned URL (s3Public)
    metrics/MetricsService.ts       # In-memory Prometheus metrics (histograms + counters)
  types/
    index.ts                   # Shared TypeScript interfaces

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
The SAM template takes the runtime API key as a `NoEcho` deployment parameter, and GitHub Actions passes it from the `API_KEY` repository secret.
`./scripts/aws-setup.sh` bootstraps the OIDC provider, deploy role, buckets, ECR repository, and GitHub secrets.

For local SAM deploys, copy `samconfig.example.toml` to `samconfig.toml` and fill in the placeholders.

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

Build the image and run anywhere Docker is supported:

```bash
docker build -t folio .
docker run -p 8080:8080 --env-file .env folio
```

Published images are also available from GHCR:

```bash
docker run -p 8080:8080 --env-file .env ghcr.io/alegerber/folio:latest
```

---

## Roadmap

See [`.plans/PLAN.md`](.plans/PLAN.md) for the full feature roadmap.

Release automation and GHCR publishing are in place. Planned features (in order): Screenshot API → OpenAPI docs → LibreOffice conversion → Async webhooks → Queue-based scaling.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, Conventional Commits, PR expectations, and route patterns.

## License

MIT. See [LICENSE](LICENSE).
