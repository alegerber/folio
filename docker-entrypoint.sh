#!/bin/sh
set -e

if [ -z "$AWS_LAMBDA_RUNTIME_API" ]; then
  exec node dist/local.js
else
  exec /lambda-entrypoint.sh "$@"
fi
