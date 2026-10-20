# FINETECH Landing Page

This is the first implementation slice of the FINETECH Figma file. The page is split into reusable React sections and backed by a small Node HTTP service.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite client and the local monitor API together. Vite proxies `/api/*` to the API process on port `3001`; `npm run dev:client` remains available for visual-only work.

Development uses Vite HMR for the React/CSS files and Node's watch mode for `server/index.mjs`. Editing either side reloads the changed part automatically; manual restarts are not required during development.

### Public-data collector

The historical and current-day collection routes retain the old program's separate local collector process. Start it once before using the live monitor features:

```bash
cd ../大剧热度Tracking优化/drama-heat-collector
npm run dev
```

It listens on `http://127.0.0.1:8890` by default. Set `DRAMA_COLLECTOR_URL` before starting the landing-page API if the collector runs at another local address. The UI exposes collector health at `GET /api/collector/health` and records a readable source-state error when it is unavailable.

## API

- `GET /api/health`
- `GET /api/site-config`
- `GET /api/features`
- `GET /api/dramas/search?q=<title>`
- `GET /api/dramas/:id?provider=<catalog|douban|tvmaze|domestic>`
- `GET /api/dramas/recommend?premiere=YYYY-MM-DD`
- `POST /api/collect/cross`
- `GET /api/collect/guduo-history`
- `GET /api/collect/maoyan-history`
- `GET /api/collect/maoyan-metric`
- `GET /api/collect/ky`
- `GET /api/collect/tv-ratings`
- `GET /api/collector/health`
