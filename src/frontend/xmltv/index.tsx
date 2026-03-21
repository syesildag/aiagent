import React from 'react';
import { createRoot } from 'react-dom/client';
import XmltvApp from './XmltvApp';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <XmltvApp />
  </React.StrictMode>
);

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/static/sw.js', { scope: '/' })
      .then((reg) => console.info('[PWA] Service worker registered, scope:', reg.scope))
      .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
  });
}
