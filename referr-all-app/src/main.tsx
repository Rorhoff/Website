import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { capturePremiumSessionFromUrl, redirectLegacyStripeReturnPath } from './lib/premium';

capturePremiumSessionFromUrl();
if (redirectLegacyStripeReturnPath()) {
  // Navigation in progress — do not mount the app on the legacy /referr-all/ path.
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {});
  });
}
