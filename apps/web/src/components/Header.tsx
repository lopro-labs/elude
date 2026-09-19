import { useStore } from '../state/store';
import { formatCount, formatDate, formatShortDate } from '../util/format';
import { IconEye, IconSettings, Logo } from '../icons/Icons';
import { MOCK } from '../api/client';

export function Header() {
  const stats = useStore((s) => s.stats);
  const health = useStore((s) => s.health);
  const healthError = useStore((s) => s.healthError);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const startWatch = useStore((s) => s.startWatch);

  const ghOk = health?.graphhopper.ok ?? false;
  const dotClass = healthError ? 'status-dot--bad' : health ? (ghOk ? 'status-dot--ok' : 'status-dot--warn') : '';
  const dotTitle = healthError ? 'API unreachable' : health ? (ghOk ? 'Routing engine online' : 'Routing engine starting') : 'Checking…';

  return (
    <header className="hdr">
      <Logo className="hdr__logo" />
      <div className="hdr__grow">
        <h1 className="hdr__title">
          <span className="wordmark">elude</span>
          <span className="hdr__tagline">drive unseen</span>
          {MOCK && <small>mock data</small>}
        </h1>
        <div className="hdr__meta">
          <span className={`status-dot ${dotClass}`} title={dotTitle} aria-label={dotTitle} />
          {stats ? (
            <span title={`Camera data as of ${formatDate(stats.fetchedAt)}`}>
              <span className="hdr__num">{formatCount(stats.count)}</span> cameras · updated {formatShortDate(stats.fetchedAt)}
            </span>
          ) : (
            <span>Loading camera data…</span>
          )}
          <a href="https://deflock.org" target="_blank" rel="noopener noreferrer" title="Camera data comes from DeFlock / OpenStreetMap">
            via DeFlock
          </a>
        </div>
      </div>
      <div className="hdr__actions">
        <button className="icon-btn" onClick={startWatch} title="Watch mode: track your position without a route and warn about nearby cameras" aria-label="Watch for cameras">
          <IconEye />
        </button>
        <button
          className={`icon-btn${settingsOpen ? ' icon-btn--active' : ''}`}
          onClick={() => setSettingsOpen(!settingsOpen)}
          title="Route settings"
          aria-label="Route settings"
          aria-expanded={settingsOpen}
        >
          <IconSettings />
        </button>
      </div>
    </header>
  );
}
