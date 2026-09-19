import type {
  BBox,
  CameraCollection,
  CameraStats,
  GeocodeResult,
  HealthResponse,
  RouteRequest,
  RouteResponse,
} from '@elude/shared';
import * as mock from './mock';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');
export const MOCK = import.meta.env.VITE_MOCK_API === '1' || import.meta.env.VITE_MOCK_API === 'true';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Could not reach the Elude API. Is the server running?');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string };
    const code = b.error ?? (res.status === 502 ? 'UPSTREAM' : `HTTP_${res.status}`);
    const message = b.message ?? b.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, code, message);
  }
  return body as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  if (MOCK) return mock.getHealth();
  return request<HealthResponse>('/health', { signal });
}

export function getCameraStats(signal?: AbortSignal): Promise<CameraStats> {
  if (MOCK) return mock.getCameraStats();
  return request<CameraStats>('/cameras/stats', { signal });
}

export function getCameras(bbox: BBox, manufacturer?: string, categories?: string[], signal?: AbortSignal): Promise<CameraCollection> {
  if (MOCK) return mock.getCameras(bbox, categories);
  const params = new URLSearchParams({ bbox: bbox.map((v) => v.toFixed(5)).join(',') });
  if (manufacturer) params.set('manufacturer', manufacturer);
  if (categories && categories.length) params.set('categories', categories.join(','));
  return request<CameraCollection>(`/cameras?${params}`, { signal });
}

export function postRoute(req: RouteRequest, signal?: AbortSignal): Promise<RouteResponse> {
  if (MOCK) return mock.postRoute(req);
  return request<RouteResponse>('/route', { method: 'POST', body: JSON.stringify(req), signal });
}

export function geocode(q: string, near?: [number, number] | null, limit = 6, signal?: AbortSignal): Promise<GeocodeResult[]> {
  if (MOCK) return mock.geocode(q);
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (near) {
    params.set('lon', near[0].toFixed(5));
    params.set('lat', near[1].toFixed(5));
  }
  return request<GeocodeResult[]>(`/geocode?${params}`, { signal });
}

export function reverseGeocode(lngLat: [number, number], signal?: AbortSignal): Promise<GeocodeResult | null> {
  if (MOCK) return mock.reverseGeocode(lngLat);
  const params = new URLSearchParams({ lat: lngLat[1].toFixed(6), lon: lngLat[0].toFixed(6) });
  return request<GeocodeResult | null>(`/geocode/reverse?${params}`, { signal });
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'NO_ROUTE') return 'No drivable route was found between these points. Try moving a pin onto a road.';
    if (err.status === 502 || err.code === 'UPSTREAM') return 'The routing engine is not responding yet. It may still be importing map data.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
