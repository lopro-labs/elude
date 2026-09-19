/**
 * Diagnostics gate. Route timings and other dev-only readouts are hidden unless
 * diagnostics are enabled, via any of:
 *   - the Vite dev server (import.meta.env.DEV),
 *   - `?debug` in the URL,
 *   - localStorage `elude:debug` = "1",
 *   - the "Show diagnostics" setting (passed in by the caller).
 * The URL / localStorage escape hatches work against the production Docker build
 * without a rebuild.
 */
export function debugFlag(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).has('debug')) return true;
    return window.localStorage.getItem('elude:debug') === '1';
  } catch {
    return false;
  }
}

/** True when diagnostics should be shown, combining the setting with the flags above. */
export function diagnosticsEnabled(showDiagnosticsSetting: boolean): boolean {
  return showDiagnosticsSetting || debugFlag();
}

/**
 * Persist a `?debug` URL flag into localStorage so it survives the address-bar
 * rewrite done by useUrlSync. `?debug` / `?debug=1` turns diagnostics on;
 * `?debug=0` / `?debug=off` turns them off. Call once before first render.
 */
export function applyDebugFromUrl(): void {
  try {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('debug')) return;
    const v = (params.get('debug') ?? '').toLowerCase();
    if (v === '0' || v === 'off' || v === 'false') window.localStorage.removeItem('elude:debug');
    else window.localStorage.setItem('elude:debug', '1');
  } catch {
    /* localStorage unavailable */
  }
}
