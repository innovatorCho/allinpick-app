This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

올리브영 가격 추적 MVP — 자세한 배경/설계는 `AGENTS.md`를 참고하세요.

## One-time setup

상품/가격 수집이 실제 브라우저 엔진(Playwright + Chromium)으로 동작하므로, 최초 1회만 Chromium 바이너리를 받아야 합니다 (npm install에는 포함되지 않음):

```bash
npx playwright install chromium
```

## Vercel 이전 가능성 — 서버리스 크롤러 Docker 테스트

`collectors/oliveyoung/serverlessProductCollector.ts`는 Vercel 이전을 검토하면서 추가한 대체 수집기로, `@sparticuz/chromium`(AWS Lambda/Vercel Functions 런타임용 경량 Chromium)을 씁니다. 실제 앱(`collectOliveYoungProduct`)에서는 전혀 쓰이지 않고, 관리자 화면의 "🧪 서버리스 크롤러 테스트" 도구와 `/api/dev/test-serverless-crawl`에서만 씁니다.

이 바이너리는 **macOS/Windows에서 전혀 실행되지 않습니다** (`spawn ENOEXEC`) — Lambda의 Amazon Linux 런타임 전용이라서, 로컬에서 의미 있게 테스트하려면 Docker로 그 환경을 흉내내야 합니다:

```bash
# Docker Desktop이 켜져 있어야 함
npm run test:serverless-crawl
# 또는 특정 상품 URL로:
npm run test:serverless-crawl -- "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=<goodsNo>"
```

최초 실행 시 `Dockerfile.serverless-test` 기반 이미지를 자동으로 빌드합니다(1~2분). Apple Silicon 맥에서는 x86_64 에뮬레이션(QEMU)으로 돌기 때문에 실제 Vercel보다 느리게 측정됩니다 — 소요시간은 참고용이고, 정확한 수치는 실제 배포 후에나 알 수 있습니다.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
