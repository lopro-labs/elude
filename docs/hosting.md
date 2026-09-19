# Hosting Elude — options and recommendations

## Short answer

**Netlify can host the frontend, but not the app.** The interesting parts of Elude are long-running
servers that Netlify's model (static files + short-lived functions) can't run.

## Why Netlify alone doesn't fit

- **GraphHopper** is a JVM process holding the routing graph in RAM (a US-wide graph is ~12 GB; a
  single state is far smaller) and it must stay warm. Netlify Functions are ~1 GB,
  10–26 s, and stateless — a non-starter.
- **The API** keeps 20k cameras + an R-tree in memory and calls GraphHopper over localhost. It
  *could* be rewritten as functions, but there's no point without GraphHopper next to it.

So the shape is: **static UI on a CDN + a container host with a few GB of RAM for `graphhopper` +
`api`.** The repo is already set up for that (`docker compose`, nginx proxying `/api`).

## Options for the backend (rough costs, Aug 2026)

| Option | RAM you get | Cost | Notes |
|---|---|---|---|
| **Hetzner Cloud VPS** (CX32 / CPX31: 8 GB, 80 GB) | 8 GB | ~€7–15/mo | Best value by far. `docker compose up` as-is, put Caddy in front for TLS. **Default recommendation.** |
| **Oracle Cloud "Always Free" ARM** (4 OCPU, 24 GB) | 24 GB | $0 | Fits the whole-US graph with the memory-mapped prod config. GraphHopper image is multi-arch. Capacity in popular regions can be scarce; fine for a hobby / public beta. |
| DigitalOcean / Linode / Vultr 8 GB droplet | 8 GB | ~$40–48/mo | Same as Hetzner, more expensive, US datacenters. |
| **Fly.io** machine + volume | 8 GB | ~$40+/mo | Nice for containers, but RAM is the cost driver here. |
| Render / Railway | — | $$ | RAM-priced; 8 GB tiers get expensive and persistent disk is awkward for the graph cache. |
| **Your own box + Cloudflare Tunnel** | whatever you have | $0 | You already run it. Tunnel gives HTTPS + a public hostname with no open ports. Great for a private / family deployment. |
| AWS / GCP / Azure | any | most $ | Overkill unless you already live there. |

Whole-US later needs ~32 GB for the import (less to serve) → a Hetzner dedicated/AX box or a big
Oracle ARM instance.

## For the frontend

Netlify, **Cloudflare Pages**, or Vercel are all fine and free for `apps/web`:

- build: `npm run build -w apps/web`
- publish dir: `apps/web/dist`
- set `VITE_API_BASE` to your API's public URL (CORS is already enabled on the API)

Honestly, though, since nginx in the `web` container already serves the SPA and proxies `/api`, the
simplest production setup is **everything on one VPS**:

```
Caddy (auto TLS)  →  web (nginx, SPA + /api proxy)  →  api (Node)  →  graphhopper (JVM)
```

One `docker compose up`, one domain, no CORS.

## Things to sort out before it's public (regardless of host)

1. **Geocoding.** Photon/Nominatim public instances are for light / fair use and forbid heavy
   autocomplete traffic. For a public site, self-host Photon (there is a docker image; needs a big
   index) or use a commercial geocoder (Geoapify / LocationIQ have free tiers). OpenFreeMap tiles are
   explicitly fine for public use.
2. **Rate limiting** on `/api/route` — each request fans out to 3 GraphHopper searches (~0.5–1 s of
   CPU). `@fastify/rate-limit` is a one-liner to add.
3. **Privacy posture** (this *is* a privacy app): the server sees origins/destinations. Turn Fastify
   request logging off or scrub coordinates, keep GraphHopper's request log off (already is), no
   analytics on the frontend, and say so in a short privacy note.
4. **Auto-updates.** Cameras refresh every 6 h already; the OSM road graph doesn't. A monthly cron that
   re-downloads the PBF and re-imports (`--import`, then restart) keeps roads current.
5. **Attribution** (ODbL / DeFlock / GraphHopper / OpenFreeMap) is already in the README and map;
   keep it visible in the UI footer too.

## Recommendation

A **US VPS with ≥ 24 GB RAM** (~$25/mo; or **Oracle free ARM** if you want $0 and can get
capacity) running the compose stack behind a Cloudflare Tunnel, a domain of your choosing,
and Cloudflare in front for DNS / TLS / basic DDoS.

Since the switch to the **whole contiguous US** (12 GB graph), the 8 GB "default" boxes above are
undersized for `RAM_STORE` — the production compose memory-maps the graph (`MMAP`) so it fits on a
24 GB box with `JAVA_OPTS=-Xmx14g`. See **[`docs/deploy.md`](deploy.md)** for the step-by-step.

### Done (previously "next steps")

- ✅ `docker-compose.prod.yml` — Caddy (auto TLS), MMAP graph, only 80/443 exposed
- ✅ `@fastify/rate-limit` on `/api/route` and `/api/geocode` (env-tunable)
- ✅ request-log scrubbing (no coordinates or client IPs in logs)
- ✅ `docs/deploy.md` — Oracle Free ARM guide + monthly graph-refresh cron
- Still open: self-hosted/keyed geocoder for heavy public traffic (Photon/Nominatim are fair-use)
