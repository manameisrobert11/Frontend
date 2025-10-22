// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')        // served from public/
      .catch((e) => console.warn('SW registration failed:', e));
  });
}

