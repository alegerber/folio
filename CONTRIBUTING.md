# Contributing

Thanks for contributing to folio.

## Local setup

```bash
npm install
cp .env.example .env
docker compose up
```

The API will be available at `http://localhost:8080` and MinIO at `http://localhost:9001`.

## Checks

Run these before opening a pull request:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Use `docker compose up` when you want the full local API + MinIO stack. Tests do not require a real browser or S3 account because those dependencies are mocked.

## Commit messages

This repo uses Conventional Commits so release-please can automate release PRs and changelog updates.

Examples:

- `feat(pdf): add html screenshot route`
- `fix(storage): handle missing object keys`
- `docs(readme): update ghcr pull instructions`

## Pull requests

- Branch from `main`.
- Keep the PR focused on one change.
- Make sure the checks above pass locally or explain any gaps.
- Update docs when you change routes, environment variables, workflows, or deployment behavior.
- Include request or response examples when you change the public API.

## Adding a route

Use the existing routes as reference implementations:

- `src/routes/health/` is the smallest example.
- `src/routes/pdf/` shows the full pattern with schema, handlers, and storage integration.

For new routes:

1. Add the route module under `src/routes/<name>/`.
2. Keep validation close to the route, following the `schema.ts` pattern where needed.
3. Register the route from `src/server.ts`.
4. Add integration coverage under `test/integration/` with `app.inject()`.
5. Update `README.md` and `AGENTS.md` if the public API or operational model changes.
