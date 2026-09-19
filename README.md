# Elude — drive unseen

Google-Maps-style driving directions that **avoid ALPR / Flock Safety cameras**, using the same
crowdsourced data as [DeFlock](https://deflock.org) (OpenStreetMap nodes tagged
`surveillance:type=ALPR`). If a zero-camera route exists it is returned — however long the detour;
if not, the route crossing the **fewest** cameras is returned. The plain fastest route is always
shown alongside for comparison, and a live turn-by-turn navigation mode follows you along the way.

```
Browser (React + MapLibre GL)  →  api (Node 20 / Fastify)  →  GraphHopper 11 (Java routing engine)
                                      ├→ Overpass API  (camera nodes, cached on disk, refreshed every 6 h)
                                      └→ Photon / Nominatim / US Census (address search)
```

## Features

- **Camera-avoiding routing** — strict (zero-camera) with automatic fewest-camera fallback, a
  penalized "balanced" mode, and the plain fastest route, shown as selectable **comparison cards**.
- **Direction-aware avoidance** — cameras tagged with a facing direction only block the side they can
  see; passing behind a one-way ALPR isn't counted (toggleable).
- **Multi-stop routes** — up to 8 draggable waypoints.
- **User avoid-zones** — draw circles/polygons the route must steer around, independent of cameras.
- **Other surveillance categories** — ALPR plus speed cameras, red-light cameras, and generic CCTV,
  each toggleable for display and avoidance.
- **Exposure report** — a timeline of every camera you'll pass, and a coverage overlay showing each
  camera's direction and field of view.
- **Live navigation** — turn-by-turn with voice, GPS or simulated drive, off-route rerouting, and a
  screen wake-lock. Installable **PWA** with an offline shell.
- **Share & export** — routes encode into the URL (shareable/refresh-proof) and export to **GPX**.
- **Real address search** — Photon for places, with a free **US Census** house-number fallback.

## Quick start (Docker)

Requirements: Docker Desktop with ≥ 8 GB RAM assigned, ~6 GB free disk.

```bash
cp .env.example .env          # optional: change region, buffer radius, memory
docker compose up --build
```

First start downloads the OSM extract (a small sample region by default) and imports it into
GraphHopper — **15–30 min** depending on your machine. Later starts reuse `./data/graph-cache`
and are up in ~1 min.

- Web app: http://localhost:8080
- API: http://localhost:3210/api/health
- GraphHopper: http://localhost:8989 (its own debugging UI lives at `/maps/`)

## Quick start (native, no Docker)

Requirements: Node 20+, Java 17+ (Java 21 recommended), ~6 GB free RAM for GraphHopper.

```powershell
npm install
cp .env.example .env
scripts/run-graphhopper.ps1        # downloads the PBF + GraphHopper jar, imports, then serves on :8989
npm run dev                        # api on :3210, web on :5173 (Vite proxies /api)
```

Linux/macOS: use `scripts/run-graphhopper.sh`. Run `scripts/run-graphhopper.ps1 -Import` once to only
build the graph cache.

## Changing the region

Set `OSM_PBF_URL` (any [Geofabrik](https://download.geofabrik.de/) extract) and `REGION_BBOX`
(`south,west,north,east`, used for the camera download) in `.env`, delete `data/region.osm.pbf` and
`data/graph-cache/`, and start again. The whole **contiguous US** works (`us-latest.osm.pbf`,
`REGION_BBOX=24.4,-125.0,49.4,-66.9`) but the 12 GB graph needs either ~26 GB RAM in the default
in-heap mode (`JAVA_OPTS=-Xmx20g`) or the memory-mapped production setup on a 24 GB box
(`JAVA_OPTS=-Xmx14g`) — see [`docs/deploy.md`](docs/deploy.md).

## How avoidance works

1. Cameras inside the route's bounding box (expanded ≥ 15 km) are buffered with a circle
   (default **30 m**, adjustable 15–150 m in the UI) and unioned into one MultiPolygon.
2. Three GraphHopper requests run in parallel using per-request
   [custom models](https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md):
   - **strict** — `in_cams → priority 0` (hard block; bridges/tunnels over/under a camera are only
     penalised because a 2-D buffer can't tell an overpass from the street below);
   - **soft** — `in_cams → priority × 0.02` (strong penalty ⇒ crosses cameras only when necessary);
   - **fastest** — no avoidance (baseline).
3. Strict wins if it found a path; otherwise soft ("fallback: N unavoidable"). Cameras whose buffer
   contains the origin/destination are excluded from strict (they are unavoidable) and reported.
4. Camera crossings are computed for every candidate by point-to-line distance and shown on the map.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `OSM_PBF_URL` | small sample extract | Routing region (any Geofabrik extract, or the whole US) |
| `REGION_BBOX` | sample region (S,W,N,E) | Camera download bbox — match your `OSM_PBF_URL` |
| `JAVA_OPTS` | `-Xmx6g -Xms2g` | GraphHopper heap |
| `CAMERA_BUFFER_M` | `30` | Default avoidance radius |
| `CAMERA_REFRESH_HOURS` | `6` | Overpass refresh interval |
| `OVERPASS_URLS` | overpass-api.de, kumi.systems | Mirrors, tried in order |
| `PHOTON_URL` / `NOMINATIM_URL` | public instances | Geocoders (rate limited; self-host for heavy use) |
| `VITE_MAP_STYLE_URL` | OpenFreeMap Liberty | Any MapLibre style JSON |

## Repository layout

```
apps/api        Fastify API: camera store (Overpass + rbush), avoid geometry, GraphHopper client, planner
apps/web        React + Vite + MapLibre UI: search, route/camera layers, turn-by-turn, navigation mode
packages/shared TypeScript contract shared by api and web
graphhopper/    GraphHopper config (car profile, LM/hybrid mode, road_environment encoded value)
scripts/        Native helpers: fetch-osm, run-graphhopper
data/           (gitignored) OSM extract, graph cache, camera cache
```

## Known limitations

- Buffers are circles, so a camera on a surface street next to a freeway ramp or frontage road can
  also penalise those edges. Bridge/tunnel edges are penalised rather than blocked, and such crossings
  are flagged "possibly not visible". Lower the radius if routes look over-cautious.
- Direction-aware avoidance uses OSM `direction` tags when present; cameras without a tagged facing
  are treated as omnidirectional (avoided both ways). Turn it off to treat every camera as omni.
- Coverage is only as good as DeFlock/OSM crowdsourcing. Strict mode can produce very long detours
  by design — the fallback and fastest routes are always shown for comparison.
- Public Photon/Nominatim/OpenFreeMap endpoints are shared community services; be considerate. For a
  public deployment, rate-limit and consider a self-hosted/keyed geocoder (see `docs/deploy.md`).

## Deploy

For a public deployment (automatic HTTPS via Caddy, memory-mapped graph so the whole US fits on a
small/free box, rate limiting, and coordinate-free logs), use the production override:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

See **[`docs/deploy.md`](docs/deploy.md)** for a step-by-step $0 Oracle Cloud Free ARM guide (and a
no-VM Cloudflare Tunnel alternative), and **[`docs/hosting.md`](docs/hosting.md)** for hosting options
and costs.

## Contributing

Contributions welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** (develop against a small state
extract, not the whole US) and the **[Code of Conduct](CODE_OF_CONDUCT.md)**. CI runs `npm run
typecheck` and `npm test -w apps/api` on every PR.

## License

Source code is [MIT](LICENSE). Camera and map **data** are separate: © OpenStreetMap contributors via
DeFlock under the [ODbL](https://opendatacommons.org/licenses/odbl/) — improve coverage upstream at
[openstreetmap.org](https://www.openstreetmap.org) / [DeFlock](https://deflock.org).

## Credits

Camera data © OpenStreetMap contributors via DeFlock (ODbL). Routing by GraphHopper. Map tiles by
OpenFreeMap / OpenMapTiles. Address search by Photon / Nominatim and the US Census geocoder.
