# Stage 1: build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY tsconfig.json .
COPY src/ src/
RUN npm run build

# Stage 2: production (Lambda base image includes the Runtime Interface Emulator)
FROM public.ecr.aws/lambda/nodejs:20
WORKDIR /var/task
COPY --from=builder /app/dist ./dist
COPY package*.json .
RUN npm ci --omit=dev

ENV CHROMIUM_PATH=/var/task/node_modules/@sparticuz/chromium/bin/chromium

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["dist/lambda.handler"]
