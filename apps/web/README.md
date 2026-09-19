# @elude/web

The Elude web app — a React + Vite + MapLibre GL single-page UI for camera-avoiding
routing and turn-by-turn navigation. Talks to [`@elude/api`](../api) over `/api`.

## Develop
```bash
npm run dev -w apps/web          # Vite dev server on :5173, proxies /api to the api on :3210
VITE_MOCK_API=1 npm run dev -w apps/web   # frontend only, synthetic data (no api/GraphHopper)
npm run build -w apps/web        # production bundle → apps/web/dist
npm run typecheck -w apps/web
```

## Env (build-time, baked by Vite)
| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE` | `/api` | API base URL (set to the public API origin if not same-origin) |
| `VITE_MAP_STYLE_URL` | OpenFreeMap Liberty | Any MapLibre style JSON |
| `VITE_MOCK_API` | – | `1` to use built-in mock data |

## What's here
- `map/` — MapLibre map, camera + route layers, avoid-zone drawing, camera coverage overlay
- `components/` — search (with waypoints), route summary + comparison cards, exposure report, settings
- `nav/` — live navigation (GPS/simulation, voice, wake lock, off-route reroute)
- `state/` — zustand store · `api/` — typed API client + mock · `util/` — geo, gpx, url-state, geometry

Production build/serve is via `apps/web/Dockerfile` (nginx serves `dist` and proxies `/api`).
