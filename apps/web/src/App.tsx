import { useEffect, useRef, useState } from 'react';
import { MapView } from './map/MapView';
import { Header } from './components/Header';
import { SearchPanel } from './components/SearchPanel';
import { RouteSummary } from './components/RouteSummary';
import { ExposureReport } from './components/ExposureReport';
import { TurnByTurn } from './components/TurnByTurn';
import { TripLog } from './components/TripLog';
import { SettingsPanel } from './components/SettingsPanel';
import { HealthBanner } from './components/HealthBanner';
import { NavHud } from './nav/NavHud';
import { useNavigation } from './nav/useNavigation';
import { useWatch } from './nav/useWatch';
import { useRouting } from './hooks/useRouting';
import { useUrlSync } from './hooks/useUrlSync';
import { useStore } from './state/store';
import { IconEye, IconList } from './icons/Icons';

/** Handle drag distance that counts as a gesture rather than a tap. */
const SHEET_DRAG_PX = 24;
/** Scrolling this far inside a collapsed sheet expands it. */
const SHEET_EXPAND_SCROLL_PX = 40;

function RouteState() {
  const loading = useStore((s) => s.routeLoading);
  const error = useStore((s) => s.routeError);
  const route = useStore((s) => s.route);
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);

  if (loading && !route) {
    return (
      <div className="state" role="status">
        <span className="spinner" />
        Finding a route around cameras…
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <div className="skeleton" style={{ width: '40%', height: 26 }} />
          <div className="skeleton" style={{ width: '65%' }} />
          <div className="skeleton" style={{ width: '90%', height: 44, marginTop: 6 }} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="state state--error" role="alert">
        <div className="state__title">Couldn't build a route</div>
        {error}
      </div>
    );
  }
  if (!route && (!origin || !destination)) {
    return (
      <div className="state state--empty">
        {!origin && !destination ? (
          <>
            Pick a <b>start</b> and a <b>destination</b> to get driving directions that steer clear of licence-plate readers.
          </>
        ) : !origin ? (
          <>
            Now choose a <b>starting point</b> — search above, click the map, or use your location.
          </>
        ) : (
          <>
            Now choose a <b>destination</b> — search above or click the map.
          </>
        )}
        <div className="state__legend">
          <div>
            <span className="legend-line" /> Camera-avoiding route
          </div>
          <div>
            <span className="legend-line legend-line--fast" /> Fastest route, for comparison
          </div>
          <div>
            <span className="legend-dot" /> ALPR camera (DeFlock / OpenStreetMap)
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export default function App() {
  useRouting();
  useUrlSync();
  useNavigation();
  useWatch();
  const navActive = useStore((s) => s.nav.active);
  const panelOpen = useStore((s) => s.panelOpen);
  const setPanelOpen = useStore((s) => s.setPanelOpen);
  const startWatch = useStore((s) => s.startWatch);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const route = useStore((s) => s.route);
  const routeLoading = useStore((s) => s.routeLoading);
  const [collapsed, setCollapsed] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);

  // Auto-collapse the bottom sheet on mobile once a route arrives, so the map shows.
  useEffect(() => {
    if (route && window.matchMedia('(max-width: 720px)').matches) setCollapsed(true);
  }, [route]);

  // Grab handle: tap toggles; drag up expands, drag down collapses.
  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) < SHEET_DRAG_PX) return;
    d.moved = true;
    setCollapsed(dy > 0);
    d.y = e.clientY;
  };
  const onHandlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.moved) setCollapsed((c) => !c);
  };
  // Scrolling the sheet's content while collapsed means the user wants more of it.
  const onSheetScroll = () => {
    if (collapsed && sheetRef.current && sheetRef.current.scrollTop > SHEET_EXPAND_SCROLL_PX) setCollapsed(false);
  };

  const hidden = navActive || !panelOpen;

  return (
    <div className="app">
      <MapView />
      <HealthBanner />
      <NavHud />

      <aside
        ref={sheetRef}
        className={`panel${hidden ? ' panel--hidden' : ''}${collapsed ? ' panel--collapsed' : ''}`}
        aria-hidden={hidden}
        aria-label="Directions panel"
        onScroll={onSheetScroll}
      >
        <button
          className="panel__handle"
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={() => { drag.current = null; }}
        />
        <Header />
        <div className="panel__scroll">
          <SearchPanel />
          {settingsOpen && <SettingsPanel />}
          <RouteState />
          {route && routeLoading && (
            <div className="state" role="status" style={{ padding: '8px 16px' }}>
              <span className="spinner" />
              Updating route…
            </div>
          )}
          <RouteSummary />
          <ExposureReport />
          <TurnByTurn />
          <TripLog />
          <footer className="panel__disclaimer">
            <b>Camera locations are community-sourced</b> (©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              OpenStreetMap contributors
            </a>{' '}
            via{' '}
            <a href="https://deflock.org" target="_blank" rel="noopener noreferrer">
              DeFlock
            </a>
            , ODbL) and may be incomplete or out of date — a “0 cameras” route means zero <i>known</i> cameras. Elude is an awareness
            tool: obey all traffic laws and drive safely. Nothing you do here is stored on a server.
          </footer>
        </div>
      </aside>

      {!navActive && !panelOpen && (
        <button className="panel-toggle" onClick={() => setPanelOpen(true)} aria-label="Show directions">
          <IconList /> <span className="panel-toggle__label">Directions</span>
        </button>
      )}
      {!navActive && (
        <button className="watch-fab" onClick={startWatch} title="Scout: camera alerts while you drive, no route needed" aria-label="Scout for mapped cameras">
          <IconEye /> <span>Scout</span>
        </button>
      )}
    </div>
  );
}
