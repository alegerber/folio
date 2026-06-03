# Stage 1: build
# Pinned by digest for reproducibility (node:24-slim, linux/amd64 — folio builds
# x86_64 only). Update the digest with: docker manifest inspect node:24-slim
FROM node:24-slim@sha256:cbd8bcbdfd0d148205c9449dff3ca3c9c94d73f393a0e03ef1c8d3846c5038bf AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src/ src/
RUN npm run build

# Stage 2: production image used by local Docker, Lambda deploys, and GHCR
# Pinned by digest (public.ecr.aws/lambda/nodejs:24, linux/amd64 — Lambda runs
# x86_64). Update with: docker manifest inspect public.ecr.aws/lambda/nodejs:24
FROM public.ecr.aws/lambda/nodejs:24@sha256:0ef0587366631c01cda7646c4dbd0509f622fecc56ccbed63c8dca65c26b5b2b AS server
WORKDIR /var/task
RUN dnf install -y \
      alsa-lib \
      atk \
      cups-libs \
      ghostscript \
      gtk3 \
      libX11 \
      libXcomposite \
      libXcursor \
      libXdamage \
      libXext \
      libXi \
      libXrandr \
      libXScrnSaver \
      libXtst \
      mesa-libgbm \
      nspr \
      nss \
      pango \
    && dnf clean all

COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Useful for Docker/ECS server mode (ignored by the Lambda runtime). Uses node
# rather than curl, which is not present in the Lambda base image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["dist/lambda.handler"]

# Reserved for the larger Docker-only toolchain. Keeping this target stable now
# lets the publish workflow ship predictable `-full` tags before LibreOffice
# conversion lands.
FROM server AS server-full
