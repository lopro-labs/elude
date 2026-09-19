## What & why

<!-- What does this change and what problem does it solve? Link any issue. -->

## How to test

<!-- Steps to verify locally (region used, route tried, etc.). -->

## Checklist
- [ ] `npm run typecheck` passes
- [ ] `npm test -w apps/api` passes
- [ ] Types shared between api/web live in `packages/shared`
- [ ] Behavior changes have tests (DI mocks — no live GraphHopper/Overpass in tests)
- [ ] No secrets, coordinates, or personal data added to code, logs, or fixtures
