import { useEffect, useState } from 'react';
import { useStore, type Trip } from '../state/store';
import { downloadFile } from '../util/download';
import { buildTripCsv, buildTripRequestText, tripFilename } from '../util/tripExport';
import { IconCheck } from '../icons/Icons';

/**
 * Saved drives with every camera passed, exportable as CSV or a
 * public-records request template grouped by operator.
 */
export function TripLog() {
  const trips = useStore((s) => s.trips);
  const deleteTrip = useStore((s) => s.deleteTrip);
  const clearTrips = useStore((s) => s.clearTrips);
  const sendMapCommand = useStore((s) => s.sendMapCommand);
  const newestId = trips[0]?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(newestId);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // A drive that just ended lands at the top; show it expanded right after Exit.
  useEffect(() => {
    setOpenId(newestId);
  }, [newestId]);

  if (trips.length === 0) return null;

  const copyRequest = async (trip: Trip) => {
    try {
      await navigator.clipboard.writeText(buildTripRequestText(trip));
      setCopiedId(trip.id);
      window.setTimeout(() => setCopiedId((id) => (id === trip.id ? null : id)), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="trips" aria-label="Trip log">
      <div className="expo__head">
        <span>Trip log</span>
        <span>
          {trips.length} trip{trips.length === 1 ? '' : 's'} · stored on this device
        </span>
      </div>
      <div className="field__help">
        Times, positions and operators of cameras you passed. Use the request text to ask each operator for the data they captured (public-records / FOIA).
      </div>

      {trips.map((trip) => {
        const open = openId === trip.id;
        const n = trip.passes.length;
        return (
          <div className="trip" key={trip.id}>
            <button className="expo__row" aria-expanded={open} onClick={() => setOpenId(open ? null : trip.id)}>
              <span className="expo__dot" />
              <span className="expo__at">{new Date(trip.startedAt).toLocaleDateString()}</span>
              <span className="expo__meta">
                {trip.originLabel || 'Start'} → {trip.destinationLabel || 'End'}
                {trip.mode !== 'route' && (
                  <>
                    {' '}
                    <span className="hud__flag hud__flag--info">{trip.mode === 'watch' ? 'Watch' : 'Simulated'}</span>
                  </>
                )}
              </span>
              <span className="expo__eta">
                {n} camera{n === 1 ? '' : 's'}
              </span>
            </button>

            {open && (
              <>
                <ul className="expo__list">
                  {trip.passes.map((p) => (
                    <li key={p.cameraId}>
                      <button className="expo__row" onClick={() => sendMapCommand({ type: 'fly-to', lngLat: p.lngLat, zoom: 16 })}>
                        <span className={`expo__dot${p.possiblyNotVisible ? ' expo__dot--maybe' : ''}`} />
                        <span className="expo__at">{new Date(p.at).toLocaleTimeString()}</span>
                        <span className="expo__meta">{p.manufacturer ?? 'ALPR camera'}</span>
                        <span className="expo__eta">{p.operator ?? 'operator not tagged'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="summary__actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => downloadFile(buildTripCsv(trip), tripFilename(trip), 'text/csv')}>
                    Export CSV
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => copyRequest(trip)}>
                    {copiedId === trip.id ? (
                      <>
                        <IconCheck /> Copied
                      </>
                    ) : (
                      'Copy request text'
                    )}
                  </button>
                  <button className="btn btn--danger btn--sm" onClick={() => deleteTrip(trip.id)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {trips.length > 1 && (
        <div className="summary__actions">
          <button className="btn btn--ghost btn--sm" onClick={clearTrips}>
            Clear all trips
          </button>
        </div>
      )}
    </section>
  );
}
