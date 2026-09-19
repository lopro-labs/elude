import type { Strictness, SurveillanceCategory } from '@elude/shared';
import { avoidanceToSoftFactor, CATEGORY_META, SURVEILLANCE_CATEGORIES, useStore, type ManufacturerFilter } from '../state/store';
import { AvoidZones } from './AvoidZones';
import { IconClose } from '../icons/Icons';

function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <div className="toggle-row">
      <div>
        <div>{label}</div>
        {help && <div className="field__help">{help}</div>}
      </div>
      <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
    </div>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const stats = useStore((s) => s.stats);

  const avoidanceLabel = settings.avoidance >= 0.8 ? 'Strong' : settings.avoidance >= 0.45 ? 'Medium' : 'Weak';
  const manufacturers = stats ? Object.entries(stats.manufacturers).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];

  return (
    <section className="settings" aria-label="Route settings">
      <div className="settings__head">
        <span>Route settings</span>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close settings">
          <IconClose />
        </button>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="strictness">
          Avoidance mode
        </label>
        <select id="strictness" className="select" value={settings.strictness} onChange={(e) => update({ strictness: e.target.value as Strictness })}>
          <option value="strict-then-fallback">Strict — zero cameras if at all possible</option>
          <option value="balanced">Balanced — avoid unless the detour is huge</option>
          <option value="none">Off — fastest route</option>
        </select>
        <div className="field__help">
          {settings.strictness === 'strict-then-fallback' && 'Takes any detour to avoid every camera. Falls back to the fewest-camera route when none exists.'}
          {settings.strictness === 'balanced' && 'One pass with cameras penalized. Use the strength slider to tune the trade-off.'}
          {settings.strictness === 'none' && 'Ignores cameras entirely. Handy for comparison.'}
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="buffer">
          Buffer around each camera <output>{settings.bufferM} m</output>
        </label>
        <input id="buffer" type="range" min={15} max={150} step={5} value={settings.bufferM} onChange={(e) => update({ bufferM: Number(e.target.value) })} />
        <div className="field__help">Roads within this radius of a camera are treated as watched. Larger buffers avoid more but detour further.</div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="avoid">
          Avoidance strength{' '}
          <output>
            {avoidanceLabel} · factor {avoidanceToSoftFactor(settings.avoidance)}
          </output>
        </label>
        <input id="avoid" type="range" min={0} max={1} step={0.05} value={settings.avoidance} onChange={(e) => update({ avoidance: Number(e.target.value) })} disabled={settings.strictness === 'none'} />
        <div className="field__help">Only affects Balanced mode (and the fallback pass): weak = short detours, strong = almost any detour.</div>
      </div>

      <div className="field">
        <Toggle
          label="Direction-aware avoidance"
          help="Cameras tagged with a facing direction are only avoided where they can see you — passing behind them doesn't count."
          checked={settings.directionAware}
          onChange={(v) => update({ directionAware: v })}
        />
      </div>

      <div className="field">
        <div className="field__label">Cameras to avoid</div>
        <div className="seg" role="group" aria-label="Manufacturer filter">
          {(
            [
              ['all', 'All ALPR'],
              ['flock', 'Flock Safety'],
              ['custom', 'Custom'],
            ] as [ManufacturerFilter, string][]
          ).map(([v, label]) => (
            <button key={v} aria-pressed={settings.manufacturerFilter === v} onClick={() => update({ manufacturerFilter: v })}>
              {label}
            </button>
          ))}
        </div>
        {settings.manufacturerFilter === 'custom' && (
          <div style={{ marginTop: 8 }}>
            <input
              className="text-input"
              placeholder="Manufacturer contains… e.g. Motorola"
              value={settings.manufacturerCustom}
              onChange={(e) => update({ manufacturerCustom: e.target.value })}
              list="manufacturers"
            />
            <datalist id="manufacturers">
              {manufacturers.map(([m]) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}
        {manufacturers.length > 0 && (
          <div className="field__help">
            In data:{' '}
            {manufacturers.map(([m, n]) => `${m} (${n.toLocaleString()})`).join(', ')}
          </div>
        )}
      </div>

      <div className="field field__grid">
        <div>
          <div className="field__label">Units</div>
          <div className="seg" role="group" aria-label="Units">
            <button aria-pressed={settings.units === 'imperial'} onClick={() => update({ units: 'imperial' })}>
              Miles
            </button>
            <button aria-pressed={settings.units === 'metric'} onClick={() => update({ units: 'metric' })}>
              Kilometres
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        <div className="field__label">Surveillance layers</div>
        <div className="surv">
          <div className="surv__head">
            <span />
            <span>Show</span>
            <span>Avoid</span>
          </div>
          {SURVEILLANCE_CATEGORIES.map((cat: SurveillanceCategory) => {
            const meta = CATEGORY_META[cat];
            const show = settings.surveillanceShow[cat];
            const avoid = settings.surveillanceAvoid[cat];
            const isAlpr = cat === 'alpr';
            return (
              <div className="surv__row" key={cat}>
                <span className="surv__name">
                  <span className="surv__swatch" style={{ background: meta.color }} />
                  {meta.label}
                </span>
                <input
                  type="checkbox"
                  className="surv__box"
                  checked={show}
                  disabled={isAlpr}
                  aria-label={`Show ${meta.label}`}
                  title={isAlpr ? 'ALPR cameras are always shown' : `Show ${meta.label} on the map`}
                  onChange={(e) => update({ surveillanceShow: { ...settings.surveillanceShow, [cat]: e.target.checked } })}
                />
                <input
                  type="checkbox"
                  className="surv__box"
                  checked={avoid}
                  aria-label={`Avoid ${meta.label}`}
                  title={`Route around ${meta.label}`}
                  onChange={(e) => update({ surveillanceAvoid: { ...settings.surveillanceAvoid, [cat]: e.target.checked } })}
                />
              </div>
            );
          })}
        </div>
        <div className="field__help">Extra categories come from OpenStreetMap and are fetched for the current view. Data is sparser than ALPR.</div>
      </div>

      <div className="field">
        <AvoidZones />
      </div>

      <div className="field">
        <div className="field__label">Map layers</div>
        <Toggle label="Show cameras" checked={settings.showCameras} onChange={(v) => update({ showCameras: v })} />
        <Toggle label="Show fastest route for comparison" checked={settings.showFastest} onChange={(v) => update({ showFastest: v })} />
        <Toggle label="Show avoided area" help="The buffered zones actually sent to the router." checked={settings.showAvoidArea} onChange={(v) => update({ showAvoidArea: v })} />
        <Toggle label="Voice guidance" checked={settings.voice} onChange={(v) => update({ voice: v })} />
        <Toggle
          label="Camera alerts while navigating"
          help="Warns ~300 m before a camera and again as you pass it (voice follows the Voice guidance switch)."
          checked={settings.cameraAlerts}
          onChange={(v) => update({ cameraAlerts: v })}
        />
        <Toggle label="Show diagnostics" help="Per-stage route timings under the summary and in the console." checked={settings.showDiagnostics} onChange={(v) => update({ showDiagnostics: v })} />
      </div>
    </section>
  );
}
