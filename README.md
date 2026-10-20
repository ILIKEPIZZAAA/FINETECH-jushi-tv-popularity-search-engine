# FINETECH剧势-电视剧热度搜索引擎

This repository contains the FINETECH drama-popularity dashboard and the local collection service it uses.

## Project layout

- `landingpage-app/` — React/Vite interface and Node API.
- `大剧热度Tracking优化/drama-heat-collector/` — local public-data collector used by the API.

## Run locally

Install both sets of dependencies once:

```bash
cd 大剧热度Tracking优化/drama-heat-collector
npm ci
cd ../../landingpage-app
npm ci
npm run dev
```

The local stack listens on `127.0.0.1:5173` (web), `127.0.0.1:3001` (API), and `127.0.0.1:8890` / `127.0.0.1:8891` (collectors).

Runtime credentials and analytics records belong in local environment configuration and `landingpage-app/.runtime/`. They are intentionally excluded from version control. Set administrator passwords through the interactive `landingpage-app/scripts/set-analytics-password.mjs` script; never commit the generated auth file or a real password.
