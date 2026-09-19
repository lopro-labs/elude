import { useStore } from '../state/store';
import { zoneLabel } from '../util/zoneGeometry';
import { IconClose, IconMap } from '../icons/Icons';

/**
 * Draw / manage user avoid zones — areas the route hard-avoids regardless of
 * cameras (a checkpoint, a neighbourhood, a toll gantry).
 */
export function AvoidZones() {
  const zones = useStore((s) => s.zones);
  const draw = useStore((s) => s.draw);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const removeZone = useStore((s) => s.removeZone);
  const clearZones = useStore((s) => s.clearZones);
  const sendMapCommand = useStore((s) => s.sendMapCommand);

  const drawing = draw.mode !== 'off';

  return (
    <section className="zones" aria-label="Avoid areas">
      <div className="zones__head">
        <span>Avoid areas</span>
        {zones.length > 0 && (
          <button className="zones__clear" onClick={clearZones} type="button">
            Clear all
          </button>
        )}
      </div>

      <div className="zones__tools" role="group" aria-label="Draw an avoid area">
        <button
          className={`seg-btn${draw.mode === 'circle' ? ' seg-btn--on' : ''}`}
          aria-pressed={draw.mode === 'circle'}
          onClick={() => setDrawMode(draw.mode === 'circle' ? 'off' : 'circle')}
          type="button"
        >
          ○ Circle
        </button>
        <button
          className={`seg-btn${draw.mode === 'polygon' ? ' seg-btn--on' : ''}`}
          aria-pressed={draw.mode === 'polygon'}
          onClick={() => setDrawMode(draw.mode === 'polygon' ? 'off' : 'polygon')}
          type="button"
        >
          ⬠ Area
        </button>
      </div>

      {drawing ? (
        <div className="zones__hint">
          {draw.mode === 'circle' ? 'Click a centre on the map, then click again for the radius.' : 'Click points on the map; double-click or Enter to finish, Esc to cancel.'}
        </div>
      ) : (
        <div className="zones__hint zones__hint--muted">Routes will steer around these areas even if it costs time.</div>
      )}

      {zones.length > 0 && (
        <ul className="zones__list">
          {zones.map((z) => {
            const center: [number, number] = z.zone.type === 'circle' ? z.zone.center : z.zone.points[0];
            return (
              <li key={z.id} className="zones__item">
                <span className="zones__swatch" />
                <span className="zones__label">{zoneLabel(z.zone)}</span>
                <button className="icon-btn" title="Show on map" aria-label="Show on map" onClick={() => sendMapCommand({ type: 'fly-to', lngLat: center, zoom: 14 })}>
                  <IconMap width={15} height={15} />
                </button>
                <button className="icon-btn" title="Remove area" aria-label="Remove area" onClick={() => removeZone(z.id)}>
                  <IconClose width={15} height={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
