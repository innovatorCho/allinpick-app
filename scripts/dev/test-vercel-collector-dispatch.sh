#!/bin/bash
# Runs scripts/dev/test-vercel-collector-dispatch.ts inside the same
# Amazon-Linux-based image Dockerfile.serverless-test builds — see that file
# and the .ts script for why this can't run directly on macOS/Windows.
#
# Usage:
#   npm run test:vercel-collector-dispatch                  # default product
#   npm run test:vercel-collector-dispatch -- "<goodsNo URL>"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

IMAGE="allinpick-serverless-test:latest"

if ! docker info > /dev/null 2>&1; then
  echo "Docker가 실행 중이 아닙니다 — Docker Desktop을 먼저 켜주세요." >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "[test-vercel-collector-dispatch] 테스트 이미지가 없어서 먼저 빌드합니다 (최초 1회만, 1~2분 소요)..."
  docker build --platform linux/amd64 -f Dockerfile.serverless-test -t "$IMAGE" .
fi

docker run --rm \
  --platform linux/amd64 \
  -v "$PROJECT_ROOT":/app \
  -w /app \
  "$IMAGE" \
  -c 'node --experimental-strip-types --import ./scripts/verify/register.mjs scripts/dev/test-vercel-collector-dispatch.ts "$@"' \
  bash "$@"
