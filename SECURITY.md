# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities by emailing the maintainers directly or by using [GitHub's private vulnerability reporting](https://github.com/alegerber/folio/security/advisories/new).

When reporting, please include:

- A description of the vulnerability
- Affected version, image tag, or commit SHA
- Deployment mode: Docker, local Node, or AWS Lambda
- Clear reproduction steps or a proof of concept
- Expected impact and any assumptions about attacker access
- Relevant logs, request samples, or configuration details with secrets redacted
- Any suggested fix (if applicable)

## Response Timeline

- **Acknowledgement**: We will acknowledge receipt of your report within 72 hours.
- **Assessment**: We aim to assess and validate the vulnerability within 7 days.
- **Fix**: Critical vulnerabilities will be prioritized and patched as soon as possible.


## Operational Security Notes

Folio renders HTML with headless Chromium and stores generated files in S3-compatible object storage. For production deployments:

- Set `API_KEY` and require `X-Api-Key` on all requests.
- Use least-privilege AWS IAM or scoped S3 credentials limited to the required bucket and actions.
- Keep Node.js, Chromium, Ghostscript, and container base images up to date.
- Treat the default local MinIO credentials (`minioadmin` / `minioadmin`) as development-only.
- Do not expose internal S3 or MinIO endpoints publicly.
- If `GHOSTSCRIPT_PATH` is enabled, keep Ghostscript patched and only use trusted binaries from your image or host.
- Be careful with untrusted HTML input. Large or complex documents can still create denial-of-service pressure through CPU, memory, and render time.

## Scope

Security reports are most helpful when they cover issues such as:

- Authentication bypass
- Authorization flaws
- Secret leakage
- SSRF, request smuggling, or unsafe outbound access
- S3 object access control problems
- Remote code execution or container escape concerns
- Denial-of-service issues with realistic impact

Questions about general hardening, feature requests, or local demo setup are better handled through normal project discussions unless they expose a concrete security vulnerability.
