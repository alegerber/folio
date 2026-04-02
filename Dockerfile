# Stage 1: build
FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
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
RUN npm install --omit=dev

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["dist/lambda.handler"]

# Reserved for the larger Docker-only toolchain. Keeping this target stable now
# lets the publish workflow ship predictable `-full` tags before LibreOffice
# conversion lands.
FROM server AS server-full
