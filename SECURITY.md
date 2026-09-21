# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private reporting: **Security → Report a vulnerability** on this repository
(this creates a private advisory only maintainers can see). If that is unavailable to you,
open a plain issue that says only "security — please contact me" and a maintainer will reach
out to arrange a private channel.

Include what you can: affected component (`apps/api`, `apps/web`, deployment files), steps to
reproduce, impact, and any proof-of-concept. You'll get an acknowledgement within 7 days and a
fix or a plan within 30 days for confirmed issues. Credit is given in the release notes unless
you ask otherwise.

## Scope

In scope:
- The API (`apps/api`): request handling, rate limiting, log scrubbing, Overpass/geocoder
  client behaviour, GraphHopper custom-model construction.
- The web app (`apps/web`): XSS, unsafe handling of URL-encoded route state, clipboard/export
  paths, service-worker caching.
- Deployment files (`docker-compose*.yml`, `Caddyfile`, `apps/*/Dockerfile`, `docs/deploy.md`):
  insecure defaults that affect anyone following the docs.

Out of scope:
- The accuracy of camera data. Elude reads OpenStreetMap via Overpass; wrong or missing cameras
  are a data issue, not a vulnerability — fix them upstream at
  [openstreetmap.org](https://www.openstreetmap.org) / [DeFlock](https://deflock.org).
- Third-party services the app calls (OpenFreeMap, Photon, Nominatim, US Census geocoder,
  Overpass mirrors, GraphHopper itself). Report those to their maintainers.
- Denial of service against someone else's hosted instance. Operators are expected to
  rate-limit at the edge (see `docs/deploy.md`); the reference stack does.
- Findings that require a compromised host, browser, or `.env`.

## What Elude does and doesn't store

Nothing about users is stored server-side. The API processes route requests transiently and
scrubs coordinates from its logs. Trips, settings, and avoid-zones live in the browser's
localStorage only. Camera data on disk is a cache of public OpenStreetMap data.

## Supported versions

Only the latest commit on `main` receives fixes.
