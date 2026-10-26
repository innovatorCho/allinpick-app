#!/bin/bash
# Builds (if missing) the Amazon-Linux-based test image and runs
# scripts/dev/test-serverless-crawl.ts inside it. See Dockerfile.serverless-test
# for why this exists.
#
# Usage:
#   npm run test:serverless-crawl                          # default set of products
#   npm run test:serverless-crawl -- "<url1>" "<url2>" ...  # one or more specific URLs
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
  echo "[test-serverless-crawl] 테스트 이미지가 없어서 먼저 빌드합니다 (최초 1회만, 1~2분 소요)..."
  docker build --platform linux/amd64 -f Dockerfile.serverless-test -t "$IMAGE" .
fi

# "$@" (this script's own args — zero or more product URLs) are forwarded as
# positional args to the bash -c script below, where they become its own
# "$@" (after the leading "bash" placeholder fills $0). This avoids building
# an unsafe interpolated command string when passing multiple URLs.
docker run --rm \
  --platform linux/amd64 \
  -v "$PROJECT_ROOT":/app \
  -w /app \
  "$IMAGE" \
  -c 'node --experimental-strip-types --import ./scripts/verify/register.mjs scripts/dev/test-serverless-crawl.ts "$@"' \
  bash "$@"
