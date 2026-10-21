# ShieldIQ X Frontend

Standalone Next.js frontend bundle for GitHub and Netlify/Vercel deployment. The FastAPI backend is not included; configure `NEXT_PUBLIC_API_BASE_URL` to point at a running API.

## Local build

```bash
npm ci --include=dev
npm run build
```

## Deploy to Vercel

Import this repository as a Next.js project. Leave the root directory blank, use the default install/build commands, and add the required `NEXT_PUBLIC_*` variables in project settings.

## Deploy to Netlify

Import this repository and select Next.js detection. Leave the base directory blank. The Netlify Next.js adapter handles the runtime; do not set a static publish directory. Add the required `NEXT_PUBLIC_*` variables in site settings.

## Required environment variables

Set `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DEMO_MODE=false`, and the four Firebase web settings. The Firebase project must match the Firebase project configured by the API. Do not commit `.env.local` or other environment files with real values.
