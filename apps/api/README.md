# @elude/api

Fastify backend for Elude. It keeps an in-memory, spatially indexed set of
ALPR cameras (OpenStreetMap `surveillance:type=ALPR`, i.e. the DeFlock data set) and
asks a self-hosted GraphHopper for routes that steer around them.

```
npm run dev -w apps/api      # tsx watch, reads ../../.env
npm test -w apps/api         # vitest
npm run typecheck -w apps/api
npm run snapshot -w apps/api # generate an optional data/cameras.fallback.geojson from Overpass
```

The shared contract lives in `packages/shared` and is consumed as TypeScript source,
so the API runs through `tsx` in production too (see `Dockerfile`).

## Endpoints (prefix `/api`, CORS enabled)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | `HealthResponse`: GraphHopper reachability, camera store stats, result of the MultiPolygon-areas self-test (run once when GH is first seen healthy). |
| GET | `/cameras?bbox=w,s,e,n&manufacturer=flock` | GeoJSON `FeatureCollection` of cameras in the bbox (optional case-insensitive manufacturer substring). More than 20 000 features -> `413 {error:"BBOX_TOO_LARGE"}`. |
| GET | `/cameras/stats` | `CameraStats` (count, fetchedAt, source, per-manufacturer counts). |
| POST | `/route` | Body `RouteRequest` -> `RouteResponse`. Errors: `400 VALIDATION`, `400 GH_BAD_REQUEST`, `422 NO_ROUTE`, `502 GH_UNAVAILABLE`. |
| GET | `/geocode?q=&lat=&lon=&limit=` | Forward geocoding via Photon, biased by `lat`/`lon` when given -> `GeocodeResult[]`. |
| GET | `/geocode/reverse?lat=&lon=` | Reverse geocoding via Nominatim (10 min in-memory cache) -> `GeocodeResult \| null`. |

All errors are JSON: `{ "error": "CODE", "message": "..." }`.

## Environment

Loaded from `.env` in the repo root (or cwd) via dotenv; see `/.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GH_URL` | `http://localhost:8989` | GraphHopper base URL |
| `GH_PROFILE` | `car` | GraphHopper profile |
| `REGION_BBOX` | sample region | `south,west,north,east` bbox for the Overpass camera fetch (match your `OSM_PBF_URL`) |
| `CAMERA_BUFFER_M` | `30` | default avoidance radius (request may override, clamped 15-150) |
| `CAMERA_REFRESH_HOURS` | `6` | Overpass refresh interval / cache staleness |
| `OVERPASS_URLS` | overpass-api.de, kumi.systems | comma-separated mirrors, tried in order with backoff |
| `PHOTON_URL` | `https://photon.komoot.io` | forward geocoder |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | reverse geocoder |
| `API_PORT` | `3210` | listen port (host `0.0.0.0`) |
| `DATA_DIR` | `./data` | where `cameras.geojson` (Overpass cache) is stored; relative paths resolve against the `.env` directory |

## Camera store (`src/cameras/`)

1. On start, load `${DATA_DIR}/cameras.geojson` (Overpass cache with `fetchedAt`).
2. If missing or older than `CAMERA_REFRESH_HOURS`, refresh from Overpass in the
   background (`nwr["surveillance:type"~"ALPR"](bbox); out center meta;`, split into
   tiles for regions larger than 12x12 degrees). While that runs (or if it fails and
   there is no cache) an optional snapshot at `data/cameras.fallback.geojson`
   is served if present (generate one for your region with `npm run snapshot`);
   otherwise the store starts empty until the first Overpass fetch lands.
3. Features are indexed in an `rbush` R-tree; `query(bbox, manufacturer?)` and
   `stats()` are O(log n). Stale data is served if a refresh fails.

## Routing (`src/routing/`)

`planRoute(RouteRequest)`:

1. Defaults / clamps: `bufferM` 30 (15-150), `softFactor` 0.02 (0.001-0.99),
   `strictness` `strict-then-fallback`.
2. Query cameras in the origin/destination bbox expanded by max(20 %, 15 km),
   optionally filtered by manufacturer.
3. Cameras whose buffer contains the origin or destination are *unavoidable* and are
   excluded from the strict pass (reported in `unavoidable`).
4. Build the avoid area (`avoidGeometry.ts`): a circumscribed 12-gon per camera,
   overlapping ones unioned with `polygon-clipping`, emitted as one GeoJSON Feature
   `{ id: "cams", geometry: MultiPolygon }`. That feature goes into
   `custom_model.areas`, with the priority rules
   `in_cams && (road_environment == BRIDGE || road_environment == TUNNEL) -> 0.1`
   (a camera on the road below/above probably cannot see you) and
   `in_cams -> 0` (strict, edges are blocked) or `-> softFactor` (soft pass).
5. Fire GraphHopper requests in parallel (`ch.disable=true`, LM/hybrid mode):
   *fastest* (no custom model), *strict* (block), *soft* (penalise all cameras).
   If strict finds no connection it is retried once with a 3x larger camera bbox.
6. `chosen = strict ?? soft ?? fastest`; `mode` is `strict`, `fallback` (or
   `balanced` for `strictness=balanced`), or `fastest-only`. Every returned path
   gets `camerasCrossed` (`crossings.ts`: cameras within `bufferM` of the polyline,
   `possiblyNotVisible` when the crossing segment is a bridge/tunnel per the
   `road_environment` path detail).

`strictness=none` skips both avoidance passes; `balanced` runs only the soft pass.

## Files

- `src/index.ts` - server bootstrap, graceful shutdown
- `src/server.ts` - Fastify app factory (`buildServer`, used by tests)
- `src/routes/*` - HTTP handlers (zod-validated)
- `src/cameras/overpass.ts`, `store.ts` - camera fetch / cache / index
- `src/routing/avoidGeometry.ts`, `graphhopper.ts`, `crossings.ts`, `planner.ts`
- `src/geocode/photon.ts`, `nominatim.ts`
- `scripts/fetch-fallback.ts` - regenerates the bundled snapshot
- `test/*.test.ts` - vitest unit/integration tests (GraphHopper is mocked)
