import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { seedUrlState } from './hooks/useUrlSync';
import { applyDebugFromUrl } from './util/debug';
import './styles.css';

// Persist a ?debug flag before it is stripped from the URL by useUrlSync.
applyDebugFromUrl();

// Apply ?from/?to/?via from a shared link before anything renders,
// so URL params beat persisted state deterministically.
seedUrlState();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA: register the service worker (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
