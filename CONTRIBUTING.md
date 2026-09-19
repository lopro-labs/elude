# Contributing to Elude

Thanks for helping people drive unseen. Elude avoids ALPR / Flock cameras using
crowdsourced [DeFlock](https://deflock.org) / OpenStreetMap data and GraphHopper.

## Ground rules
- Be respectful — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Keep the tool focused: **avoid surveillance cameras for lawful, everyday travel and
  privacy.** We don't accept features aimed at evading law enforcement, tampering,
  or targeting individuals.
- Camera data belongs to OpenStreetMap (ODbL). Improve coverage upstream at
  [openstreetmap.org](https://www.openstreetmap.org) / [DeFlock](https://deflock.org),
  not by bundling scraped datasets here.

## Project layout
```
apps/api        Fastify API — camera store (Overpass + rbush), avoid geometry, GraphHopper planner
apps/web        React + Vite + MapLibre UI
packages/shared TypeScript contract shared by api and web
graphhopper/    GraphHopper config (dev = RAM_STORE, prod = MMAP)
docs/           hosting.md, deploy.md
```

## Local setup (use a small region!)
You do **not** need the whole US to develop — it's a 12 GB, ~26 GB-RAM import. Use a
single state (or a metro extract) so the graph imports in minutes on any machine.

```bash
npm ci
cp .env.example .env          # defaults to a small sample region — leave it, or pick any extract
docker compose up --build     # downloads the extract + imports GraphHopper (once), then serves
# → web http://localhost:8080 · api http://localhost:3210/api/health
```

Faster inner loop without Docker for the api/web (needs GraphHopper running separately):
```bash
scripts/run-graphhopper.sh    # or .ps1 on Windows — imports + serves GraphHopper on :8989
npm run dev                   # api :3210, web :5173 (Vite proxies /api)
```
Frontend-only work can skip the backend entirely with mock data: `VITE_MOCK_API=1 npm run dev -w apps/web`.

## Before you open a PR
```bash
npm run typecheck             # all workspaces
npm test -w apps/api          # 100+ vitest tests, no Docker/GraphHopper needed (uses DI mocks)
```
Both must pass — CI runs exactly these on every PR.

## Style
- TypeScript, `strict`. Match the surrounding code — naming, comment density, and idioms.
- Keep the api/web contract in `packages/shared`; don't duplicate types.
- Small, focused PRs with a clear description. Add or update tests for behavior changes
  (see `apps/api/test/` for the DI patterns — GraphHopper, Overpass, and geocoders are all
  injectable, so tests never hit the network).

## Reporting bugs / ideas
Open an issue using the templates. For a routing bug, include the origin/destination,
region, and settings (buffer, strictness) so it's reproducible. For a *missing or wrong
camera*, fix it in OpenStreetMap/DeFlock — Elude will pick it up on the next refresh.
