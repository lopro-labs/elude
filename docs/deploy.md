# Deploying Elude (whole US, one VPS, Cloudflare Tunnel)

Reference deployment, verified 2026-09 on a US VPS (8 vCore, 24 GB, 200 GB NVMe,
~$25/mo): the whole-US graph memory-mapped, no inbound ports, TLS terminated at
Cloudflare's edge.

Any Linux box with **≥ 22 GB usable RAM, ≥ 60 GB disk** and x86-64 or arm64 works
the same way (Oracle Cloud's Always-Free 4 OCPU / 24 GB ARM shape included, if you
can get capacity). Pricing moves; check the provider's order form, not this file.

> Already running the stack on a desktop? Skip to **Cloudflare Tunnel from a machine
> you already run** at the bottom — $0, same result, as long as that machine stays on.

## 0. What you need
- A VPS as above, Ubuntu 24.04+ (arm64 is fine: `israelhikingmap/graphhopper` is multi-arch).
- A domain on Cloudflare (free plan) and a Zero Trust account (free, ≤50 users).
- ~4 hours, almost all of it the unattended US import. Budget accordingly.

## 1. Cloudflare Tunnel
Zero Trust → **Networks → Tunnels → Create a tunnel → Cloudflared**, name it, save.
- Copy the connector **token** (the `eyJ…` string after `service install`). Do not
  install cloudflared anywhere — it runs as a container in the compose stack.
- **Public Hostname**: subdomain blank, your domain, type **HTTP**, URL **`web:80`**.
  `web`, not `localhost`: the connector runs inside the compose network and reaches
  nginx by service name. Saving creates the proxied DNS record for you.
- Optional: a `www` hostname, or a Redirect Rule "WWW to root" on the zone.

## 2. Server prep
```bash
ssh ubuntu@<vm-ip>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version   # v2.24+ required (the prod override uses the !reset tag)
```
**MMAP writeback tuning — required.** The import writes randomly into memory-mapped
files; with default kernel settings dirty pages are flushed every 30 s and the
landmark phase becomes disk-bound for hours (measured: 75 % I/O stall, 95 % disk
busy, CPU idle). Let dirty pages stay in RAM:
```bash
printf 'vm.dirty_background_ratio = 50\nvm.dirty_ratio = 80\nvm.dirty_expire_centisecs = 360000\nvm.dirty_writeback_centisecs = 30000\n' \
  | sudo tee /etc/sysctl.d/90-elude-mmap.conf && sudo sysctl --system
```

## 3. Code and config
```bash
git clone <YOUR_REPO_URL> elude && cd elude
cp .env.example .env
mkdir -p data && chmod 777 data   # the curl download image runs as a non-root uid
```
Edit `.env`:
```ini
OSM_PBF_URL=https://download.geofabrik.de/north-america/us-latest.osm.pbf
REGION_BBOX=24.4,-125.0,49.4,-66.9
# MMAP keeps the GRAPH out of the heap, but the location-index build is in-heap
# and OOMs at 6 GB on the US graph. 14 GB on a 24 GB box leaves ~8 GB of page cache.
JAVA_OPTS=-Xmx14g -Xms2g
TUNNEL_TOKEN=eyJ...
```
Keep `.env` private (`chmod 600 .env`): the token lets anyone run a connector for your tunnel.

## 4. Launch
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d --build
```
What happens, with times measured on the box above:
1. `osm-download` fetches the ~12 GB US extract (~15 min at 12 MB/s).
2. `graphhopper` imports it: OSM read ~60 min, sort ~5 min, location index ~4 min,
   **landmark prep ~60 min single-threaded** (this is the phase that stalls without
   the sysctl above). Total **≈ 2¼ h**. Watch with `docker logs -f elude-graphhopper-1`.
3. `api` and `web` start once GraphHopper's healthcheck passes; `cloudflared`
   connects immediately and returns Cloudflare 502 until then — that's the ingress
   chain working, not a fault.

The healthcheck `start_period` is 180 min. If the import outlives it the container
shows `unhealthy` while still importing; that's cosmetic, nothing restarts.

When `docker compose ps` shows everything healthy:
- `https://<your domain>/` — the app
- `https://<your domain>/api/health` — `ok: true` with the US camera count
  (Overpass fetch takes ~15 min on first start; routing works meanwhile).

**Take a provider snapshot now.** A rebuild from snapshot is minutes; a re-import is hours.

## Why memory-mapped (MMAP)?
`graphhopper/config.prod.yml` sets `graph.dataaccess.default_type: MMAP` (dev uses
`RAM_STORE`). The 12 GB graph lives on disk and the OS pages it in, so serving needs
RAM for hot pages only, and query latency is fine after warm-up. Two things still need
heap: the location-index build during import (hence `-Xmx14g`) and normal request
handling. `RAM_STORE` would need `-Xmx20g`+ and a 32 GB box.

## Maintaining it
- **App deploys** (api/web code): rebuild only those two, never touch GraphHopper:
  ```bash
  git pull
  docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml build api web
  docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d --no-deps api web
  ```
  A plain `up -d` after compose-file changes can recreate the GraphHopper container;
  mid-import that corrupts the cache and forces a full re-import.
- **Camera data** refreshes itself every 6 h (`CAMERA_REFRESH_HOURS`), no downtime.
- **Road graph** doesn't auto-update and re-import is ~2 h of routing downtime if
  done in place. Refresh quarterly, or build into a second directory and swap:
  ```bash
  cd ~/elude && rm -f data/region.osm.pbf && rm -rf data/graph-cache
  docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d --force-recreate osm-download graphhopper
  ```
- **Restarts** are automatic (`restart: unless-stopped`); the graph loads from cache in ~1–2 min.
- **Changing** `graph.encoded_values`, profiles, or the GraphHopper image major version
  invalidates the cache → full re-import.

## Alternative ingress: Caddy on a public IP
If you'd rather not use Cloudflare, swap `docker-compose.tunnel.yml` for
`docker-compose.caddy.yml`, set `DOMAIN=` / `ACME_EMAIL=` in `.env`, open TCP 80/443
in the provider firewall, and create a DNS A record → the VM. Caddy fetches a
Let's Encrypt cert on first start.

## Geocoding at scale (heads-up)
Address search defaults to **public Photon + Nominatim**, which are fair-use only
and forbid heavy autocomplete traffic. The built-in **US Census** fallback (free,
no key) covers US house numbers. If traffic grows, switch `PHOTON_URL` to a
self-hosted Photon or a keyed provider (Geoapify / LocationIQ free tiers).

## Cloudflare Tunnel from a machine you already run
If you already run the stack locally (`docker compose up -d`, `RAM_STORE`,
`-Xmx20g`, ≥ 32 GB RAM), publish it without a VM: create a tunnel as in step 1 but
point the public hostname at `http://localhost:8080`, then install the connector
as a service on that machine (`cloudflared service install <token>`). $0, HTTPS,
no open ports, no re-import. Trade-off: that machine must stay on. Handy as a
staging environment next to the VPS.
