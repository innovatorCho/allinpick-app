#!/bin/bash
# Builds the real Next.js app inside a Lambda-like Linux container (next build
# && next start) and smoke-tests a handful of routes — a pre-Vercel-deploy
# functional check. See Dockerfile.app-test for why a real `npm install`
# happens inside the container instead of bind-mounting host node_modules.
#
# Uses a throwaway local DB INSIDE the container (not the real Turso DB) —
# this container's price scheduler would otherwise run concurrently with the
# real dev server's scheduler against the same real data, risking duplicate
# collections/notifications. This script is about "does the app build and
# serve pages correctly in a Vercel-like environment", not Turso connectivity
# itself (already verified separately — see scripts/migrate-to-turso.ts /
# chat history).
#
# Usage:
#   npm run test:vercel-build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

IMAGE="allinpick-app-test:latest"
CONTAINER="allinpick-app-test-run"
HOST_PORT="3001" # not 3000 — the real dev server is usually already on that one

if ! docker info > /dev/null 2>&1; then
  echo "Docker가 실행 중이 아닙니다 — Docker Desktop을 먼저 켜주세요." >&2
  exit 1
fi

echo "[test-vercel-build] 이미지 빌드 중 (npm install + next build을 컨테이너 안에서 실행 — 처음엔 몇 분 걸릴 수 있습니다)..."
docker build --platform linux/amd64 -f Dockerfile.app-test -t "$IMAGE" .

docker rm -f "$CONTAINER" > /dev/null 2>&1 || true

echo "[test-vercel-build] 컨테이너 실행 중 (임시 로컬 DB 사용 — 실제 Turso는 안 건드립니다)..."
docker run -d --rm \
  --platform linux/amd64 \
  --name "$CONTAINER" \
  -p "$HOST_PORT":3000 \
  -e DATABASE_PATH=/tmp/app-test.db \
  -e APP_BASE_URL="http://localhost:$HOST_PORT" \
  -e ADMIN_EMAILS=test-admin@example.com \
  -e GOOGLE_CLIENT_ID=TODO \
  -e GOOGLE_CLIENT_SECRET=TODO \
  -e KAKAO_CLIENT_ID=TODO \
  -e KAKAO_CLIENT_SECRET=TODO \
  "$IMAGE" > /dev/null

cleanup() {
  echo "[test-vercel-build] 컨테이너 정리 중..."
  docker logs "$CONTAINER" 2>&1 | tail -30
  docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[test-vercel-build] 서버 기동 대기 중..."
ready=false
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$HOST_PORT/"; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != "true" ]; then
  echo "[test-vercel-build] ❌ 서버가 30초 안에 응답하지 않았습니다."
  exit 1
fi

echo ""
echo "=== 라우트 점검 ==="
check() {
  local path="$1"
  local expect="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$HOST_PORT${path}")
  if [ "$code" = "$expect" ]; then
    echo "✅ $path → $code"
  else
    echo "❌ $path → $code (기대값 $expect)"
  fi
}

check "/" 200
check "/login" 200
check "/search" 200
check "/admin" 200
check "/product/NO_SUCH_PRODUCT" 404

echo ""
echo "[test-vercel-build] 완료"
