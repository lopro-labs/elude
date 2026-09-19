import { useStore, type CameraAlert } from '../state/store';
import { speak } from './voice';

export const ALERT_TTL_MS = 5000;

let timer: number | null = null;

/**
 * Show / speak / vibrate a camera alert. Returns false when an approach was
 * deferred because a passing alert is still on screen (passing wins).
 */
export function raiseCameraAlert(alert: CameraAlert, spoken: string): boolean {
  const s = useStore.getState();
  if (alert.phase === 'approaching' && s.nav.cameraAlert?.phase === 'passing') return false;
  s.updateNav({ cameraAlert: alert });
  if (s.settings.voice) speak(spoken, { interrupt: alert.phase === 'passing' });
  if (alert.phase === 'passing' && !alert.facingAway && typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200]);
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const now = useStore.getState();
    if (now.nav.cameraAlert?.at === alert.at) now.updateNav({ cameraAlert: null });
    timer = null;
  }, ALERT_TTL_MS);
  return true;
}

export function clearCameraAlert(): void {
  if (timer) window.clearTimeout(timer);
  timer = null;
}
