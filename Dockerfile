# Stage 1: build
FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src/ src/
RUN npm run build

# Stage 2: production image used by local Docker, Lambda deploys, and GHCR
FROM public.ecr.aws/lambda/nodejs:24 AS server
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
