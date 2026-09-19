import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CameraFeature, CameraProperties, LngLat, RoutePath } from '@elude/shared';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { getCameras, reverseGeocode } from '../api/client';
import { activeCategories, activePath, CATEGORY_META, isStopTarget, useStore, type InputTarget, type Place, type PointRole } from '../state/store';
import { addSourcesAndLayers, EMPTY_FC, LYR, SRC, setData, setVisible } from './layers';
import { shortCoord } from '../util/format';
import { cameraScopeFC } from '../util/cameraScope';
import { draftFC, zonesFC } from '../util/zoneGeometry';
import { IconLocate } from '../icons/Icons';

const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const CAMERA_MIN_ZOOM = 9;
// Opening view: the contiguous US (users search/click to their own area).
const INITIAL_VIEW: { center: LngLat; zoom: number } = { center: [-98.6, 39.5], zoom: 3.6 };

interface CtxMenu {
  x: number;
  y: number;
  lngLat: LngLat;
}

function isNarrow() {
  return window.matchMedia('(max-width: 720px)').matches;
}

/** Padding that keeps the route clear of the side panel / bottom sheet. */
function fitPadding(): maplibregl.PaddingOptions {
  if (isNarrow()) return { top: 70, left: 30, right: 30, bottom: Math.round(window.innerHeight * 0.48) };
  return { top: 60, left: 404 + 12 + 40, right: 60, bottom: 60 };
}

function lineFC(points: LngLat[]): FeatureCollection<LineString> {
  if (points.length < 2) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } }] };
}

function crossedFC(path: RoutePath | null): FeatureCollection<Point> {
  if (!path) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: path.camerasCrossed.map((c) => ({
      type: 'Feature',
      properties: { id: c.id, manufacturer: c.manufacturer ?? '', possiblyNotVisible: c.possiblyNotVisible, distanceM: c.distanceM },
      geometry: { type: 'Point', coordinates: c.lngLat },
    })),
  };
}

function compassName(deg: number): string {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function cameraPopupHtml(p: CameraProperties): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
  const rows: [string, string | undefined][] = [
    ['Manufacturer', p.manufacturer],
    ['Operator', p.operator],
    ['Facing', p.direction != null ? `${compassName(p.direction)} · ${Math.round(p.direction)}°` : undefined],
    ['Updated', p.timestamp ? new Date(p.timestamp).toLocaleDateString() : undefined],
  ];
  const body = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="cam-pop__row"><span>${k}</span><b>${esc(v)}</b></div>`)
    .join('');
  const type = p.osmType ?? 'node';
  const cat = p.category && p.category !== 'alpr' ? CATEGORY_META[p.category] : null;
  const title = cat ? cat.label : 'ALPR camera';
  const dotColor = cat ? cat.color : '#ff5a5f';
  return `
    <div class="cam-pop__title"><span class="cam-pop__dot" style="background:${dotColor}"></span>${title}</div>
    ${body || '<div class="cam-pop__row"><span>No details tagged</span></div>'}
    ${
      p.direction != null
        ? '<div class="cam-pop__note"><span class="cam-pop__beam"></span>Directional — the cone shows its likely line of sight; passing behind it isn\'t counted.</div>'
        : '<div class="cam-pop__note"><span class="cam-pop__beam cam-pop__beam--omni"></span>No facing tagged — treated as watching all directions.</div>'
    }
    <a class="cam-pop__link" href="https://www.openstreetmap.org/${type}/${p.id}" target="_blank" rel="noopener noreferrer">${type}/${p.id} on OSM ↗</a>
  `;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(INITIAL_VIEW.zoom);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [camerasLoading, setCamerasLoading] = useState(false);
  const cameraAbort = useRef<AbortController | null>(null);
  const originMarker = useRef<maplibregl.Marker | null>(null);
  const stopMarkers = useRef<maplibregl.Marker[]>([]);
  const destMarker = useRef<maplibregl.Marker | null>(null);
  const puckMarker = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const popupPinned = useRef(false);
  const cameraCache = useRef<Map<number, CameraFeature>>(new Map());
  const userInteracting = useRef(false);

  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const activeInput = useStore((s) => s.activeInput);
  const setActiveInput = useStore((s) => s.setActiveInput);
  const route = useStore((s) => s.route);
  const selectedKind = useStore((s) => s.selectedKind);
  const stops = useStore((s) => s.stops);
  const primary = activePath(route, selectedKind);
  const highlightedStep = useStore((s) => s.highlightedStep);
  const mapCommand = useStore((s) => s.mapCommand);
  const settings = useStore((s) => s.settings);
  const zones = useStore((s) => s.zones);
  const draw = useStore((s) => s.draw);
  const nav = useStore((s) => s.nav);
  const updateNav = useStore((s) => s.updateNav);
  const setUserLocation = useStore((s) => s.setUserLocation);
  const setCamerasInView = useStore((s) => s.setCamerasInView);
  const panelOpen = useStore((s) => s.panelOpen);

  const manufacturerFilter = settings.manufacturerFilter === 'flock' ? 'Flock' : settings.manufacturerFilter === 'custom' ? settings.manufacturerCustom.trim() : '';

  // ---- Place a point (with reverse geocode for the label) ------------------
  const placePoint = useCallback(
    async (target: InputTarget, lngLat: LngLat) => {
      const assign = (place: Place) => {
        const st = useStore.getState();
        if (isStopTarget(target)) st.setStop(target.stop, place);
        else st.setPlace(target, place);
      };
      assign({ lngLat, label: shortCoord(lngLat) });
      try {
        const r = await reverseGeocode(lngLat);
        if (r?.label) {
          // Only update label if the point has not moved since.
          const st = useStore.getState();
          const cur = isStopTarget(target) ? st.stops[target.stop] : st[target];
          if (cur && cur.lngLat[0] === lngLat[0] && cur.lngLat[1] === lngLat[1]) assign({ lngLat, label: r.label });
        }
      } catch {
        /* keep coordinate label */
      }
    },
    [],
  );

  // ---- Map init ------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      attributionControl: false,
      maxPitch: 70,
      pitchWithRotate: true,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    // 'style.load' fires as soon as the style is parsed (before tiles arrive), so our
    // overlays show up immediately even when the tile server is slow.
    map.on('style.load', () => {
      if (mapRef.current !== map) return; // stale instance (StrictMode double-mount)
      addSourcesAndLayers(map);
      setReady(true);
      setZoom(map.getZoom());
    });
    map.on('zoom', () => setZoom(map.getZoom()));
    map.on('error', (e) => {
      // Tile 4xx are noisy; only log real errors.
      const msg = (e as { error?: { message?: string } }).error?.message ?? '';
      if (msg && !/status/i.test(msg)) console.warn('[map]', msg);
    });

    // User interaction stops nav follow-mode
    const onUserMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) {
        userInteracting.current = true;
        const s = useStore.getState();
        if (s.nav.active && s.nav.follow) s.updateNav({ follow: false });
      }
    };
    map.on('dragstart', onUserMove);
    map.on('rotatestart', onUserMove);
    map.on('pitchstart', onUserMove);
    map.on('wheel', () => {
      const s = useStore.getState();
      if (s.nav.active && s.nav.follow) s.updateNav({ follow: false });
    });

    // Camera hover / click popups
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '300px', offset: 10 });
    popupRef.current = popup;
    const clearScope = () => setData(map, SRC.camScope, EMPTY_FC);
    popup.on('close', () => {
      popupPinned.current = false;
      clearScope();
    });
    const showPopup = (feature: maplibregl.MapGeoJSONFeature) => {
      const geom = feature.geometry as Point;
      const props = feature.properties as Record<string, unknown>;
      const id = Number(props.id);
      const cached = cameraCache.current.get(id)?.properties;
      const p: CameraProperties = cached ?? {
        id,
        osmType: (props.osmType as CameraProperties['osmType']) ?? 'node',
        manufacturer: props.manufacturer as string | undefined,
        operator: props.operator as string | undefined,
        direction: props.direction != null ? Number(props.direction) : undefined,
        timestamp: props.timestamp as string | undefined,
        tags: {},
      };
      const center = geom.coordinates as LngLat;
      popup.setLngLat(center).setHTML(cameraPopupHtml(p)).addTo(map);
      // Coverage overlay: scale the reach off the current buffer, with a floor so it stays visible.
      const rM = Math.max(useStore.getState().settings.bufferM, 55);
      setData(map, SRC.camScope, cameraScopeFC(center, p.direction, rM));
    };
    map.on('mouseenter', LYR.cameras, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      if (!popupPinned.current && e.features?.[0]) showPopup(e.features[0]);
    });
    map.on('mouseleave', LYR.cameras, () => {
      map.getCanvas().style.cursor = '';
      if (!popupPinned.current) {
        popup.remove();
        clearScope();
      }
    });
    map.on('click', LYR.cameras, (e) => {
      if (e.features?.[0]) {
        showPopup(e.features[0]);
        popupPinned.current = true;
      }
      // Prevent the generic map click handler from placing a pin.
      (e.originalEvent as MouseEvent & { _cameraHit?: boolean })._cameraHit = true;
    });

    // Long-press for touch context menu
    let pressTimer: number | null = null;
    let pressStart: { x: number; y: number } | null = null;
    map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) return;
      pressStart = { x: e.point.x, y: e.point.y };
      pressTimer = window.setTimeout(() => {
        setCtx({ x: e.point.x, y: e.point.y, lngLat: [e.lngLat.lng, e.lngLat.lat] });
        pressTimer = null;
      }, 550);
    });
    const cancelPress = () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = null;
    };
    map.on('touchmove', (e) => {
      if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 8) cancelPress();
    });
    map.on('touchend', cancelPress);
    map.on('touchcancel', cancelPress);

    map.on('contextmenu', (e) => {
      e.preventDefault();
      setCtx({ x: e.point.x, y: e.point.y, lngLat: [e.lngLat.lng, e.lngLat.lat] });
    });

    // Try to centre on the user if permission was already granted (no prompt).
    if (navigator.geolocation && 'permissions' in navigator) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((res) => {
          if (res.state !== 'granted') return;
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const ll: LngLat = [pos.coords.longitude, pos.coords.latitude];
              useStore.getState().setUserLocation(ll);
              if (!useStore.getState().route) map.flyTo({ center: ll, zoom: 12, duration: 1500 });
            },
            () => undefined,
            { maximumAge: 60_000, timeout: 8000 },
          );
        })
        .catch(() => undefined);
    }

    return () => {
      originMarker.current?.remove();
      destMarker.current?.remove();
      puckMarker.current?.remove();
      originMarker.current = destMarker.current = puckMarker.current = null;
      popup.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Generic map click: place origin/destination when an input is active --
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      setCtx(null);
      const s = useStore.getState();
      if (s.nav.active) return;
      // Drawing an avoid zone: clicks add points instead of placing route pins.
      if (s.draw.mode !== 'off') {
        s.pushDrawPoint([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if ((e.originalEvent as MouseEvent & { _cameraHit?: boolean })._cameraHit) return;
      const emptyStop = s.stops.findIndex((p) => p == null);
      const target: InputTarget | null = s.activeInput ?? (!s.origin ? 'origin' : !s.destination ? 'destination' : emptyStop >= 0 ? { stop: emptyStop } : null);
      if (!target) return;
      // Ignore clicks that hit an existing marker element
      const domTarget = e.originalEvent.target as HTMLElement | null;
      if (domTarget?.closest('.maplibregl-marker')) return;
      void placePoint(target, [e.lngLat.lng, e.lngLat.lat]);
      // Advance focus: after origin, next click sets destination
      const after = useStore.getState();
      if (target === 'origin' && !after.destination) setActiveInput('destination');
      else setActiveInput(null);
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [placePoint, setActiveInput]);

  // ---- Avoid-zone drawing interactions --------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const drawing = draw.mode !== 'off';
    // While drawing, dblclick finishes a polygon rather than zooming.
    if (drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    if (!drawing) return;

    const onMove = (e: maplibregl.MapMouseEvent) => useStore.getState().setDrawCursor([e.lngLat.lng, e.lngLat.lat]);
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      const s = useStore.getState();
      if (s.draw.mode !== 'polygon') return;
      e.preventDefault();
      if (s.draw.points.length >= 3) {
        s.addZone({ type: 'polygon', points: s.draw.points });
        s.cancelDraw();
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') useStore.getState().cancelDraw();
      else if (ev.key === 'Enter') {
        const s = useStore.getState();
        if (s.draw.mode === 'polygon' && s.draw.points.length >= 3) {
          s.addZone({ type: 'polygon', points: s.draw.points });
          s.cancelDraw();
        }
      }
    };
    map.on('mousemove', onMove);
    map.on('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('mousemove', onMove);
      map.off('dblclick', onDbl);
      window.removeEventListener('keydown', onKey);
    };
  }, [ready, draw.mode]);

  // ---- Cameras: fetch for the viewport on moveend (debounced) ---------------
  const refreshCameras = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!settings.showCameras || map.getZoom() < CAMERA_MIN_ZOOM) {
      setData(map, SRC.cameras, EMPTY_FC);
      setCamerasInView(0);
      return;
    }
    const b = map.getBounds();
    // Pad the bbox slightly so small pans do not always refetch visible edges.
    const padX = (b.getEast() - b.getWest()) * 0.15;
    const padY = (b.getNorth() - b.getSouth()) * 0.15;
    cameraAbort.current?.abort();
    const ac = new AbortController();
    cameraAbort.current = ac;
    setCamerasLoading(true);
    try {
      const cats = activeCategories(settings.surveillanceShow);
      const fc = await getCameras([b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY], manufacturerFilter || undefined, cats.length ? cats : ['alpr'], ac.signal);
      if (ac.signal.aborted) return;
      for (const f of fc.features) cameraCache.current.set(f.properties.id, f);
      setData(map, SRC.cameras, fc as FeatureCollection);
      setCamerasInView(fc.features.length);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.warn('[cameras]', (err as Error).message);
    } finally {
      if (!ac.signal.aborted) setCamerasLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.showCameras, manufacturerFilter, activeCategories(settings.surveillanceShow).join(','), setCamerasInView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let t: number | null = null;
    const schedule = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => void refreshCameras(), 350);
    };
    map.on('moveend', schedule);
    schedule();
    return () => {
      map.off('moveend', schedule);
      if (t) window.clearTimeout(t);
    };
  }, [ready, refreshCameras]);

  // ---- Route layers ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fastest = route?.fastest ?? null;
    // Comparison line: the fastest, unless it IS the selected path — then contrast with the server's chosen.
    const secondary = fastest && fastest !== primary ? fastest : primary !== route?.chosen ? (route?.chosen ?? null) : null;
    setData(map, SRC.chosen, lineFC(primary?.points ?? []));
    setData(map, SRC.fastest, lineFC(secondary && settings.showFastest ? secondary.points : []));
    setData(map, SRC.crossedFastest, crossedFC(settings.showFastest ? secondary : null));
    setData(map, SRC.crossedChosen, crossedFC(primary));
    setData(map, SRC.avoidArea, route?.avoidArea ? { type: 'FeatureCollection', features: [route.avoidArea as Feature] } : EMPTY_FC);
    if (!route) {
      setData(map, SRC.highlight, EMPTY_FC);
      setData(map, SRC.chosenDone, EMPTY_FC);
    }
  }, [ready, route, selectedKind, settings.showFastest]);

  // ---- Avoid zones + in-progress draft --------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setData(map, SRC.zones, zonesFC(zones));
  }, [ready, zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setData(map, SRC.zoneDraft, draftFC(draw) as FeatureCollection);
  }, [ready, draw]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setVisible(map, LYR.avoidFill, settings.showAvoidArea);
    setVisible(map, LYR.avoidLine, settings.showAvoidArea);
  }, [ready, settings.showAvoidArea]);

  // Highlighted step segment
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const path = primary;
    if (!path || highlightedStep == null || !path.instructions[highlightedStep]) {
      setData(map, SRC.highlight, EMPTY_FC);
      return;
    }
    const [a, b] = path.instructions[highlightedStep].interval;
    const seg = path.points.slice(a, Math.max(b + 1, a + 2));
    setData(map, SRC.highlight, lineFC(seg));
  }, [ready, route, selectedKind, highlightedStep]);

  // ---- Markers --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = (ref: React.MutableRefObject<maplibregl.Marker | null>, role: PointRole, place: { lngLat: LngLat } | null) => {
      if (!place) {
        ref.current?.remove();
        ref.current = null;
        return;
      }
      if (!ref.current) {
        const el = document.createElement('div');
        el.className = 'pin-wrap';
        el.title = role === 'origin' ? 'Start (drag to move)' : 'Destination (drag to move)';
        el.innerHTML = `<div class="pin pin--${role}"></div>`;
        const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' }).setLngLat(place.lngLat).addTo(map);
        m.on('dragend', () => {
          const ll = m.getLngLat();
          void placePoint(role, [ll.lng, ll.lat]);
        });
        ref.current = m;
      } else {
        const cur = ref.current.getLngLat();
        if (cur.lng !== place.lngLat[0] || cur.lat !== place.lngLat[1]) ref.current.setLngLat(place.lngLat);
      }
    };
    sync(originMarker, 'origin', origin);
    sync(destMarker, 'destination', destination);
  }, [origin, destination, placePoint, ready]);

  // Numbered intermediate-stop markers (rebuilt on change; stops are few).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    stopMarkers.current.forEach((m) => m.remove());
    stopMarkers.current = [];
    stops.forEach((p, i) => {
      if (!p) return;
      const el = document.createElement('div');
      el.className = 'pin-wrap';
      el.title = `Stop ${i + 1} (drag to move)`;
      el.innerHTML = `<div class="pin--stop">${i + 1}</div>`;
      const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat(p.lngLat).addTo(map);
      m.on('dragend', () => {
        const ll = m.getLngLat();
        void placePoint({ stop: i }, [ll.lng, ll.lat]);
      });
      stopMarkers.current.push(m);
    });
  }, [stops, placePoint, ready]);

  // User puck during navigation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pos = nav.active ? (nav.snapped ?? nav.position) : null;
    if (!pos) {
      puckMarker.current?.remove();
      puckMarker.current = null;
      return;
    }
    if (!puckMarker.current) {
      const el = document.createElement('div');
      el.className = 'puck';
      puckMarker.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(pos).addTo(map);
    } else {
      puckMarker.current.setLngLat(pos);
    }
    const el = puckMarker.current.getElement();
    if (nav.heading != null) {
      el.classList.add('puck--heading');
      puckMarker.current.setRotation(nav.heading);
    } else {
      el.classList.remove('puck--heading');
    }
    // Travelled portion of the route
    if (primary && nav.snapped) {
      const done = [...primary.points.slice(0, nav.snappedIndex + 1), nav.snapped];
      setData(map, SRC.chosenDone, lineFC(done));
    }
  }, [ready, nav.active, nav.snapped, nav.position, nav.heading, nav.snappedIndex, route, selectedKind]);

  // Follow the user in nav mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nav.active || !nav.follow) return;
    const pos = nav.snapped ?? nav.position;
    if (!pos) return;
    map.easeTo({
      center: pos,
      bearing: nav.heading ?? map.getBearing(),
      pitch: 50,
      zoom: 16.5,
      duration: nav.simulate ? 900 : 1000,
      easing: (t) => t,
      padding: { top: isNarrow() ? 200 : 140, bottom: 0, left: 0, right: 0 },
    });
  }, [nav.active, nav.follow, nav.snapped, nav.position, nav.heading, nav.simulate]);

  // Reset pitch/bearing when leaving nav mode
  const prevNavActive = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (prevNavActive.current && !nav.active) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      setData(map, SRC.chosenDone, EMPTY_FC);
      if (primary) map.fitBounds(primary.bbox as [number, number, number, number], { padding: fitPadding(), duration: 800 });
    }
    prevNavActive.current = nav.active;
  }, [nav.active, route, selectedKind]);

  // ---- Map commands from other components -----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapCommand) return;
    if (mapCommand.type === 'fit-route' && primary) {
      const bbox = route?.fastest && settings.showFastest ? unionBBox(primary.bbox, route.fastest.bbox) : primary.bbox;
      map.fitBounds(bbox as [number, number, number, number], { padding: fitPadding(), duration: 900, maxZoom: 16 });
    } else if (mapCommand.type === 'fly-to' && mapCommand.lngLat) {
      map.flyTo({ center: mapCommand.lngLat, zoom: mapCommand.zoom ?? Math.max(map.getZoom(), 15), duration: 900, padding: isNarrow() ? { top: 0, bottom: Math.round(window.innerHeight * 0.4), left: 0, right: 0 } : { top: 0, bottom: 0, left: panelOpen ? 420 : 0, right: 0 } });
    } else if (mapCommand.type === 'fly-user') {
      locateUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCommand]);

  const locateUser = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setUserLocation(ll);
        mapRef.current?.flyTo({ center: ll, zoom: 14, duration: 1200 });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [setUserLocation]);

  // Close context menu on escape / map move
  useEffect(() => {
    if (!ctx) return;
    const map = mapRef.current;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    map?.on('movestart', close);
    window.addEventListener('keydown', onKey);
    return () => {
      map?.off('movestart', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctx]);

  const drawing = draw.mode !== 'off' && !nav.active;
  const picking = activeInput != null && !nav.active && !drawing;
  const showZoomHint = ready && settings.showCameras && zoom < CAMERA_MIN_ZOOM && !nav.active && !drawing;

  return (
    <div className={`map${picking ? ' picking' : ''}${drawing ? ' drawing' : ''}`}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {drawing && (
        <div className="map-hint map-hint--draw" role="status">
          {draw.mode === 'circle'
            ? draw.points.length === 0
              ? 'Click to place the centre of the avoided area'
              : 'Click again to set the radius'
            : `Click to add points${draw.points.length >= 3 ? ' · double-click or Enter to finish' : ' (at least 3)'} · Esc to cancel`}
          <button className="map-hint__cancel" onClick={() => useStore.getState().cancelDraw()}>
            Cancel
          </button>
        </div>
      )}
      {picking && (
        <div className="map-hint map-hint--pick" role="status">
          Click the map to set the {activeInput === 'origin' ? 'start' : isStopTarget(activeInput) ? `stop ${activeInput.stop + 1}` : 'destination'}
        </div>
      )}
      {!picking && showZoomHint && (
        <div className="map-hint" role="status">
          <span className="map-hint__dot" /> Zoom in to see cameras
        </div>
      )}
      {!picking && !showZoomHint && camerasLoading && !nav.active && (
        <div className="map-hint" role="status">
          <span className="spinner" style={{ margin: 0 }} /> Loading cameras…
        </div>
      )}

      {nav.active && !nav.follow && (
        <button className="recenter" onClick={() => updateNav({ follow: true })}>
          <IconLocate /> Re-center
        </button>
      )}

      {ctx && (
        <div className="ctx-menu" style={{ left: Math.min(ctx.x, window.innerWidth - 210), top: Math.min(ctx.y, window.innerHeight - 140) }} role="menu">
          <button
            role="menuitem"
            onClick={() => {
              void placePoint('origin', ctx.lngLat);
              setCtx(null);
            }}
          >
            <span className="search__rail-dot" /> Route from here
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void placePoint('destination', ctx.lngLat);
              setCtx(null);
            }}
          >
            <span className="search__rail-dot search__rail-dot--dest" /> Route to here
          </button>
          {origin && destination && stops.length < 8 && (
            <button
              role="menuitem"
              onClick={() => {
                const s = useStore.getState();
                const idx = s.stops.length;
                s.setStops([...s.stops, null]);
                void placePoint({ stop: idx }, ctx.lngLat);
                setCtx(null);
              }}
            >
              <span className="search__rail-dot search__rail-dot--stop" /> Add a stop here
            </button>
          )}
          <div className="ctx-menu__coord">{shortCoord(ctx.lngLat)}</div>
        </div>
      )}
    </div>
  );
}

function unionBBox(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
