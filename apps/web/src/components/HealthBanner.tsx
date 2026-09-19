import { useEffect } from 'react';
import { getCameraStats, getHealth } from '../api/client';
import { useStore } from '../state/store';
import { IconWarning } from '../icons/Icons';

/** Polls /api/health every 10 s and shows a banner while the routing engine is unavailable. */
export function HealthBanner() {
  const health = useStore((s) => s.health);
  const healthError = useStore((s) => s.healthError);
  const setHealth = useStore((s) => s.setHealth);
  const setStats = useStore((s) => s.setStats);
  const nav = useStore((s) => s.nav);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const h = await getHealth();
        if (cancelled) return;
        setHealth(h, false);
        if (h.cameras) setStats(h.cameras);
      } catch {
        if (cancelled) return;
        setHealth(null, true);
      }
      // Poll fast while unhealthy, slower once everything is fine.
      const s = useStore.getState();
      const healthy = s.health?.ok && s.health.graphhopper.ok;
      timer = window.setTimeout(tick, healthy ? 60_000 : 10_000);
    };
    void tick();
    // Stats endpoint separately (in case /health omits it)
    getCameraStats()
      .then((st) => !cancelled && setStats(st))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [setHealth, setStats]);

  if (nav.active) return null;

  if (healthError) {
    return (
      <div className="banner banner--error" role="alert">
        <IconWarning width={20} height={20} />
        <div>
          <b>Can't reach the Elude API</b>
          <span>Retrying every 10 seconds. If you're running locally, start the API (npm run dev, default port 3210).</span>
        </div>
      </div>
    );
  }
  if (health && !health.graphhopper.ok) {
    return (
      <div className="banner" role="status">
        <span className="spinner" style={{ margin: 0 }} />
        <div>
          <b>Routing engine is starting up</b>
          <span>The first map import can take 20–30 minutes. Cameras still load; routing will work once it's ready.{health.graphhopper.message ? ` (${health.graphhopper.message})` : ''}</span>
        </div>
      </div>
    );
  }
  return null;
}
