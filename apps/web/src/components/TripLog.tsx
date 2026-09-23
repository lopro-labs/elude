import { useEffect, useState } from 'react';
import { reverseGeocode } from '../api/client';
import { useStore, type Trip } from '../state/store';
import { downloadFile } from '../util/download';
import { muckrockAgencyUrl } from '../util/recordsLaw';
import { buildOperatorRequestText, buildTripCsv, buildTripRequestText, groupByOperator, tripFilename } from '../util/tripExport';
import { IconCheck } from '../icons/Icons';

/**
 * Resolve the US state of each operator group's first pass (one reverse geocode
 * per group, sequential to respect the API rate limit) and persist it on the trip.
 */
function useResolvePassStates(trip: Trip | undefined) {
  const setTripPassStates = useStore((s) => s.setTripPassStates);
  useEffect(() => {
    if (!trip) return;
    const todo = groupByOperator(trip)
      .map((g) => g.passes[0]!)
      .filter((p) => !p.state);
    if (todo.length === 0) return;
    const ac = new AbortController();
    (async () => {
      const states: Record<number, string> = {};
      for (const p of todo) {
        try {
          const r = await reverseGeocode(p.lngLat, ac.signal);
          if (r?.state) states[p.cameraId] = r.state;
        } catch {
          if (ac.signal.aborted) return;
        }
      }
      if (!ac.signal.aborted && Object.keys(states).length) setTripPassStates(trip.id, states);
    })();
    return () => ac.abort();
  }, [trip, setTripPassStates]);
}

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
  /** trip id, or `${tripId}:${operator}` for a per-operator copy */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useResolvePassStates(trips.find((t) => t.id === openId));

  // A drive that just ended lands at the top; show it expanded right after Exit.
  useEffect(() => {
    setOpenId(newestId);
  }, [newestId]);

  if (trips.length === 0) return null;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => setCopiedId((id) => (id === key ? null : id)), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  const copied = (key: string, label: string) =>
    copiedId === key ? (
      <>
        <IconCheck /> Copied
      </>
    ) : (
      label
    );

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
                    <span className="hud__flag hud__flag--info">{trip.mode === 'watch' ? 'Scout' : 'Simulated'}</span>
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
                <div className="expo__head">
                  <span>Records requests</span>
                  <span>one per operator</span>
                </div>
                <ul className="expo__list">
                  {groupByOperator(trip).map((g) => {
                    const key = `${trip.id}:${g.operator}`;
                    return (
                      <li key={key} className="trip__op">
                        <div className="trip__op-head">
                          <span className="expo__meta">{g.operator}</span>
                          <span className="expo__eta">
                            {g.passes.length} camera{g.passes.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="field__help">
                          {g.law
                            ? `${g.law.law} (${g.law.citation}) · response within ${g.law.deadline}${g.mixedStates ? ' · spans more than one state' : ''}`
                            : 'State law not resolved — request cites "the applicable public-records law".'}
                        </div>
                        <div className="summary__actions">
                          <button className="btn btn--ghost btn--sm" onClick={() => copy(key, buildOperatorRequestText(trip, g))}>
                            {copied(key, 'Copy request')}
                          </button>
                          {g.tagged && (
                            <a className="btn btn--ghost btn--sm" href={muckrockAgencyUrl(g.operator)} target="_blank" rel="noopener noreferrer">
                              Find agency on MuckRock
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="summary__actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => downloadFile(buildTripCsv(trip), tripFilename(trip), 'text/csv')}>
                    Export CSV
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => copy(trip.id, buildTripRequestText(trip))}>
                    {copied(trip.id, 'Copy all as one')}
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
