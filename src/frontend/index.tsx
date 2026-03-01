import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatApp from './ChatApp';

// Get agent name from the URL or window object
const getAgentName = (): string => {
  const match = window.location.pathname.match(/\/front\/([^/]+)/);
  return match ? match[1] : 'general';
};

const agentName = getAgentName();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ChatApp agentName={agentName} />
  </React.StrictMode>
);

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => console.info('[PWA] Service worker registered, scope:', reg.scope))
      .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
  });
}
