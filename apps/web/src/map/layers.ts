import type maplibregl from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';

export const SRC = {
  cameras: 'cameras',
  chosen: 'route-chosen',
  chosenDone: 'route-chosen-done',
  fastest: 'route-fastest',
  highlight: 'route-highlight',
  crossedFastest: 'crossed-fastest',
  crossedChosen: 'crossed-chosen',
  avoidArea: 'avoid-area',
  camScope: 'camera-scope',
  zones: 'avoid-zones',
  zoneDraft: 'avoid-zone-draft',
} as const;

export const LYR = {
  avoidFill: 'avoid-area-fill',
  avoidLine: 'avoid-area-line',
  fastestCasing: 'route-fastest-casing',
  fastest: 'route-fastest-line',
  chosenCasing: 'route-chosen-casing',
  chosen: 'route-chosen-line',
  chosenDone: 'route-chosen-done-line',
  highlightCasing: 'route-highlight-casing',
  highlight: 'route-highlight-line',
  zonesFill: 'avoid-zones-fill',
  zonesLine: 'avoid-zones-line',
  zoneDraftFill: 'avoid-zone-draft-fill',
  zoneDraftLine: 'avoid-zone-draft-line',
  camScopeAvoidFill: 'camera-scope-avoid-fill',
  camScopeViewFill: 'camera-scope-view-fill',
  camScopeLine: 'camera-scope-line',
  camerasHalo: 'cameras-halo',
  cameras: 'cameras-circle',
  crossedFastest: 'crossed-fastest-x',
  crossedFastestLine1: 'crossed-fastest-x1',
  crossedChosenHalo: 'crossed-chosen-halo',
  crossedChosen: 'crossed-chosen-dot',
} as const;

export const EMPTY_FC: FeatureCollection<Geometry> = { type: 'FeatureCollection', features: [] };

const ROUTE_BLUE = '#4f8cff';
const ROUTE_CASING = '#153f8f';
const FASTEST_GREY = '#7a8794';
const CAMERA_RED = '#ff5a5f';
const CAUTION = '#ffb020';
const ZONE_PURPLE = '#8b6cff';

/** circle-color expression: colour each camera dot by its surveillance category. */
const CATEGORY_COLOR: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'category'],
  'speed',
  '#ffb020',
  'redlight',
  '#b57cff',
  'cctv',
  '#4aa3ff',
  CAMERA_RED, // alpr / default
];

/** Find the first symbol (label) layer so routes render beneath labels. */
function firstSymbolLayer(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  const sym = layers.find((l) => l.type === 'symbol');
  return sym?.id;
}

export function addSourcesAndLayers(map: maplibregl.Map) {
  const before = firstSymbolLayer(map);
  const add = (layer: maplibregl.LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  };
  const addSource = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
  };

  Object.values(SRC).forEach(addSource);

  // Avoid area (optional debug/insight layer)
  add({
    id: LYR.avoidFill,
    type: 'fill',
    source: SRC.avoidArea,
    paint: { 'fill-color': CAMERA_RED, 'fill-opacity': 0.15 },
    layout: { visibility: 'none' },
  });
  add({
    id: LYR.avoidLine,
    type: 'line',
    source: SRC.avoidArea,
    paint: { 'line-color': CAMERA_RED, 'line-opacity': 0.5, 'line-width': 1 },
    layout: { visibility: 'none' },
  });

  // Fastest (comparison) route: grey dashed
  add({
    id: LYR.fastestCasing,
    type: 'line',
    source: SRC.fastest,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 9], 'line-opacity': 0.9 },
  });
  add({
    id: LYR.fastest,
    type: 'line',
    source: SRC.fastest,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': FASTEST_GREY,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 5],
      'line-dasharray': [1.5, 1.5],
    },
  });

  // Chosen route: bold blue with dark casing
  add({
    id: LYR.chosenCasing,
    type: 'line',
    source: SRC.chosen,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ROUTE_CASING, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 16, 14] },
  });
  add({
    id: LYR.chosen,
    type: 'line',
    source: SRC.chosen,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ROUTE_BLUE, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 16, 9] },
  });
  // Travelled part in nav mode
  add({
    id: LYR.chosenDone,
    type: 'line',
    source: SRC.chosenDone,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#9aa8b8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 16, 9], 'line-opacity': 0.9 },
  });

  // Highlighted step segment
  add({
    id: LYR.highlightCasing,
    type: 'line',
    source: SRC.highlight,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 10, 16, 18], 'line-opacity': 0.9 },
  });
  add({
    id: LYR.highlight,
    type: 'line',
    source: SRC.highlight,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffd166', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 10] },
  });

  // User-drawn avoid zones (committed) — purple fill + line, above routes, below cameras
  add({
    id: LYR.zonesFill,
    type: 'fill',
    source: SRC.zones,
    paint: { 'fill-color': ZONE_PURPLE, 'fill-opacity': 0.16 },
  });
  add({
    id: LYR.zonesLine,
    type: 'line',
    source: SRC.zones,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ZONE_PURPLE, 'line-opacity': 0.85, 'line-width': 1.6, 'line-dasharray': [2, 1.4] },
  });
  // Zone being drawn (rubber-band preview)
  add({
    id: LYR.zoneDraftFill,
    type: 'fill',
    source: SRC.zoneDraft,
    paint: { 'fill-color': ZONE_PURPLE, 'fill-opacity': 0.12 },
  });
  add({
    id: LYR.zoneDraftLine,
    type: 'line',
    source: SRC.zoneDraft,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ZONE_PURPLE, 'line-opacity': 0.95, 'line-width': 2 },
  });

  // Camera coverage overlay (hover/click): wide avoided half-disc + brighter view cone
  add({
    id: LYR.camScopeAvoidFill,
    type: 'fill',
    source: SRC.camScope,
    filter: ['==', ['get', 'kind'], 'avoid'],
    paint: { 'fill-color': CAMERA_RED, 'fill-opacity': 0.1 },
  });
  add({
    id: LYR.camScopeViewFill,
    type: 'fill',
    source: SRC.camScope,
    filter: ['==', ['get', 'kind'], 'view'],
    paint: { 'fill-color': CAMERA_RED, 'fill-opacity': 0.28 },
  });
  add({
    id: LYR.camScopeLine,
    type: 'line',
    source: SRC.camScope,
    paint: { 'line-color': CAMERA_RED, 'line-opacity': 0.55, 'line-width': 1 },
  });

  // Cameras (added above routes, but still below labels)
  add({
    id: LYR.camerasHalo,
    type: 'circle',
    source: SRC.cameras,
    minzoom: 12,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 16],
      'circle-color': CATEGORY_COLOR,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.12, 16, 0.2],
    },
  });
  add({
    id: LYR.cameras,
    type: 'circle',
    source: SRC.cameras,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 12, 4, 16, 7],
      'circle-color': CATEGORY_COLOR,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.5],
      'circle-opacity': 0.95,
    },
  });

  // Cameras crossed on the fastest route: small red X (canvas-drawn icon so it does not depend on style fonts)
  ensureImage(map, 'camera-x', drawX);
  add({
    id: LYR.crossedFastest,
    type: 'symbol',
    source: SRC.crossedFastest,
    layout: {
      'icon-image': 'camera-x',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 16, 0.8],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  // Cameras crossed on the chosen route: orange dots (dimmed if possiblyNotVisible)
  add({
    id: LYR.crossedChosenHalo,
    type: 'circle',
    source: SRC.crossedChosen,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 16, 18],
      'circle-color': CAUTION,
      'circle-opacity': ['case', ['get', 'possiblyNotVisible'], 0.12, 0.25],
    },
  });
  add({
    id: LYR.crossedChosen,
    type: 'circle',
    source: SRC.crossedChosen,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 8],
      'circle-color': ['case', ['get', 'possiblyNotVisible'], '#ffffff', CAUTION],
      'circle-stroke-color': CAUTION,
      'circle-stroke-width': 2,
      'circle-opacity': ['case', ['get', 'possiblyNotVisible'], 0.7, 1],
    },
  });

  // Symbol layers must sit above everything so the X is visible over the route.
  if (map.getLayer(LYR.crossedFastest)) map.moveLayer(LYR.crossedFastest);
  if (map.getLayer(LYR.crossedChosenHalo)) map.moveLayer(LYR.crossedChosenHalo);
  if (map.getLayer(LYR.crossedChosen)) map.moveLayer(LYR.crossedChosen);
}

function ensureImage(map: maplibregl.Map, id: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  if (map.hasImage(id)) return;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  draw(ctx, size);
  map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 1 });
}

function drawX(ctx: CanvasRenderingContext2D, size: number) {
  const pad = 8;
  ctx.lineCap = 'round';
  // white halo
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(size - pad, size - pad);
  ctx.moveTo(size - pad, pad);
  ctx.lineTo(pad, size - pad);
  ctx.stroke();
  ctx.strokeStyle = CAMERA_RED;
  ctx.lineWidth = 4;
  ctx.stroke();
}

export function setData(map: maplibregl.Map, sourceId: string, data: FeatureCollection<Geometry> | GeoJSON.Feature) {
  const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data as GeoJSON.GeoJSON);
}

export function setVisible(map: maplibregl.Map, layerId: string, visible: boolean) {
  if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}
