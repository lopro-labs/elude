import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeocodeResult } from '@elude/shared';
import { geocode } from '../api/client';
import { isStopTarget, sameTarget, useStore, type InputTarget, type Place } from '../state/store';
import { IconClose, IconGrip, IconLocate, IconPin, IconPlus, IconSwap } from '../icons/Icons';

interface FieldProps {
  target: InputTarget;
  placeholder: string;
  ariaLabel: string;
}

const LOCATE_ITEM = '__locate__';

function PlaceField({ target, placeholder, ariaLabel }: FieldProps) {
  const place = useStore((s) => (isStopTarget(target) ? (s.stops[target.stop] ?? null) : s[target]));
  const activeInput = useStore((s) => s.activeInput);
  const setActiveInput = useStore((s) => s.setActiveInput);
  const userLocation = useStore((s) => s.userLocation);
  const setUserLocation = useStore((s) => s.setUserLocation);

  const assign = useCallback(
    (p: Place | null) => {
      const st = useStore.getState();
      if (isStopTarget(target)) st.setStop(target.stop, p);
      else st.setPlace(target, p);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStopTarget(target) ? `stop:${target.stop}` : target],
  );

  const [text, setText] = useState(place?.label ?? '');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const editing = useRef(false);

  // Sync label from the store when set externally (map click, drag, swap).
  useEffect(() => {
    if (!editing.current) setText(place?.label ?? '');
  }, [place]);

  const search = useCallback(
    (q: string) => {
      abortRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (q.trim().length < 2) {
        setResults([]);
        setBusy(false);
        return;
      }
      timerRef.current = window.setTimeout(async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy(true);
        try {
          const near = userLocation ?? useStore.getState().origin?.lngLat ?? null;
          const r = await geocode(q, near, 6, ac.signal);
          if (!ac.signal.aborted) {
            setResults(r);
            setSel(r.length ? 0 : -1);
          }
        } catch {
          if (!ac.signal.aborted) setResults([]);
        } finally {
          if (!ac.signal.aborted) setBusy(false);
        }
      }, 300);
    },
    [userLocation],
  );

  const choose = (r: GeocodeResult) => {
    editing.current = false;
    assign({ lngLat: r.lngLat, label: r.label });
    setText(r.label);
    setOpen(false);
    setResults([]);
    setActiveInput(null);
    inputRef.current?.blur();
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLocation(ll);
        editing.current = false;
        assign({ lngLat: ll, label: 'Your location' });
        setText('Your location');
        setOpen(false);
        setLocating(false);
        setActiveInput(null);
        inputRef.current?.blur();
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const items: (GeocodeResult | typeof LOCATE_ITEM)[] = target === 'origin' && text.trim().length < 2 ? [LOCATE_ITEM] : results;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      const it = items[sel] ?? items[0];
      if (it === LOCATE_ITEM) useMyLocation();
      else if (it) choose(it);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const clear = () => {
    editing.current = false;
    setText('');
    setResults([]);
    assign(null);
    setActiveInput(target);
    inputRef.current?.focus();
  };

  const isActive = sameTarget(activeInput, target);

  return (
    <div className={`search__field${isActive ? ' search__field--active' : ''}`}>
      <input
        ref={inputRef}
        className="search__input"
        placeholder={placeholder}
        value={text}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
          setOpen(true);
          search(e.target.value);
        }}
        onFocus={() => {
          setActiveInput(target);
          setOpen(true);
          if (text.trim().length >= 2 && !place) search(text);
        }}
        onBlur={() => {
          // Delay so clicks on the list register.
          window.setTimeout(() => {
            setOpen(false);
            // Restore label if the user typed but did not pick.
            if (editing.current) {
              editing.current = false;
              const st = useStore.getState();
              const cur = isStopTarget(target) ? st.stops[target.stop] : st[target];
              setText(cur?.label ?? '');
            }
          }, 160);
        }}
        onKeyDown={onKeyDown}
      />
      {(text || place) && (
        <button className="search__clear" onClick={clear} aria-label="Clear" type="button">
          <IconClose width={14} height={14} />
        </button>
      )}
      {open && (items.length > 0 || busy || (text.trim().length >= 2 && !busy)) && (
        <div className="ac" role="listbox">
          {items.map((it, i) =>
            it === LOCATE_ITEM ? (
              <button key="loc" className="ac__item ac__item--special" role="option" aria-selected={sel === i} onMouseDown={(e) => e.preventDefault()} onClick={useMyLocation}>
                <IconLocate />
                <div>
                  <div className="ac__main">{locating ? 'Locating…' : 'Use my location'}</div>
                  <div className="ac__sub">Start from where you are now</div>
                </div>
              </button>
            ) : (
              <button
                key={`${it.osmId ?? i}-${it.label}`}
                className="ac__item"
                role="option"
                aria-selected={sel === i}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(it)}
              >
                <IconPin />
                <div style={{ minWidth: 0 }}>
                  <div className="ac__main">{it.name || it.label}</div>
                  <div className="ac__sub">{it.label !== it.name ? it.label : [it.city, it.state, it.country].filter(Boolean).join(', ')}</div>
                </div>
              </button>
            ),
          )}
          {items.length === 0 && busy && <div className="ac__empty">Searching…</div>}
          {items.length === 0 && !busy && text.trim().length >= 2 && <div className="ac__empty">No places found. Try a city, address, or business name.</div>}
        </div>
      )}
    </div>
  );
}

export function SearchPanel() {
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const stops = useStore((s) => s.stops);
  const addStop = useStore((s) => s.addStop);
  const removeStop = useStore((s) => s.removeStop);
  const moveStop = useStore((s) => s.moveStop);
  const swap = useStore((s) => s.swapPlaces);
  const setStops = useStore((s) => s.setStops);
  const setPlace = useStore((s) => s.setPlace);
  const setActiveInput = useStore((s) => s.setActiveInput);
  const setRoute = useStore((s) => s.setRoute);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const clearAll = () => {
    setPlace('origin', null);
    setPlace('destination', null);
    setStops([]);
    setRoute(null);
    setActiveInput('origin');
  };

  return (
    <section className="search" aria-label="Plan a route">
      <div className="search__list">
        <div className="srow">
          <span className="search__rail-dot" aria-hidden />
          <PlaceField target="origin" placeholder="Choose a starting point" ariaLabel="Starting point" />
        </div>

        {stops.map((_, i) => (
          <div
            key={i}
            className={`srow srow--stop${dragIdx === i ? ' srow--drag' : ''}`}
            onDragOver={(e) => {
              if (dragIdx != null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx != null && dragIdx !== i) moveStop(dragIdx, i);
              setDragIdx(null);
            }}
          >
            <span
              className="srow__grip"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragIdx(i);
              }}
              onDragEnd={() => setDragIdx(null)}
              title="Drag to reorder"
              aria-hidden
            >
              <IconGrip width={14} height={14} />
            </span>
            <span className="search__rail-dot search__rail-dot--stop" aria-hidden>
              {i + 1}
            </span>
            <PlaceField target={{ stop: i }} placeholder={`Stop ${i + 1}`} ariaLabel={`Stop ${i + 1}`} />
            <button className="icon-btn srow__rm" onClick={() => removeStop(i)} aria-label={`Remove stop ${i + 1}`} type="button">
              <IconClose width={14} height={14} />
            </button>
          </div>
        ))}

        <div className="srow">
          <span className="search__rail-dot search__rail-dot--dest" aria-hidden />
          <PlaceField target="destination" placeholder="Choose a destination" ariaLabel="Destination" />
        </div>
      </div>

      <div className="search__tools">
        <button className="search__tool" onClick={addStop} disabled={stops.length >= 8} type="button" title="Add an intermediate stop">
          <IconPlus width={14} height={14} /> Add stop
        </button>
        <button className="search__tool" onClick={swap} disabled={!origin && !destination} type="button" title="Reverse the route">
          <IconSwap width={14} height={14} /> Reverse
        </button>
        {(origin || destination || stops.length > 0) && (
          <button className="search__tool" onClick={clearAll} type="button">
            Clear
          </button>
        )}
      </div>
      <div className="search__hint">
        <span>
          Tip: click the map or right-click for <kbd>Route from here</kbd>
        </span>
      </div>
    </section>
  );
}
