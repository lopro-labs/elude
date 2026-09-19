import { useMemo } from 'react';
import { activePath, useStore } from '../state/store';
import { formatDistance } from '../util/format';
import { ManeuverIcon } from '../icons/ManeuverIcon';

export function TurnByTurn() {
  const route = useStore((s) => s.route);
  const selectedKind = useStore((s) => s.selectedKind);
  const path = activePath(route, selectedKind);
  const units = useStore((s) => s.settings.units);
  const highlighted = useStore((s) => s.highlightedStep);
  const setHighlighted = useStore((s) => s.setHighlightedStep);
  const sendMapCommand = useStore((s) => s.sendMapCommand);

  // Which steps have a camera crossing inside their interval (chosen route only)
  const cameraSteps = useMemo(() => {
    const m = new Map<number, number>();
    if (!path) return m;
    const ins = path.instructions;
    for (const c of path.camerasCrossed) {
      for (let i = 0; i < ins.length; i++) {
        const [a, b] = ins[i].interval;
        if (c.pathIndex >= a && c.pathIndex <= b) {
          m.set(i, (m.get(i) ?? 0) + 1);
          break;
        }
      }
    }
    return m;
  }, [path]);

  if (!route || !path) return null;

  const onStep = (i: number) => {
    setHighlighted(i);
    const idx = Math.min(path.instructions[i].interval[0], path.points.length - 1);
    sendMapCommand({ type: 'fly-to', lngLat: path.points[idx], zoom: 15.5 });
  };

  return (
    <section className="tbt" aria-label="Turn-by-turn directions">
      <div className="tbt__head">
        <span>Directions</span>
        <span>{path.instructions.length} steps</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {path.instructions.map((ins, i) => {
          const cams = cameraSteps.get(i);
          return (
            <li key={i}>
              <button className={`step${highlighted === i ? ' step--active' : ''}`} onClick={() => onStep(i)} aria-current={highlighted === i ? 'step' : undefined}>
                <span className="step__icon">
                  <ManeuverIcon sign={ins.sign} exitNumber={ins.exitNumber} />
                </span>
                <span>
                  <div className="step__text">{ins.text}</div>
                  {ins.streetName && !ins.text.includes(ins.streetName) && <div className="step__street">{ins.streetName}</div>}
                  {cams ? (
                    <div className="step__cam">
                      {cams} camera{cams === 1 ? '' : 's'} on this stretch
                    </div>
                  ) : null}
                </span>
                <span className="step__dist">{ins.distance > 0 ? formatDistance(ins.distance, units) : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
