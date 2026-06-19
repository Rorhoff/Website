import { useEffect, useRef } from 'react';
import ReactGA from 'react-ga4';
import { isGa4Initialized } from '../lib/analytics';

function currentLocationPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Sends GA4 page_view events when the SPA route changes.
 * Pass `locationPath` from app navigation state (this project uses hash routes, not react-router).
 */
export function usePageTracking(locationPath?: string) {
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!isGa4Initialized()) return;

    const path = locationPath ?? currentLocationPath();
    if (lastTracked.current === path) return;
    lastTracked.current = path;

    ReactGA.send({
      hitType: 'pageview',
      page: path,
      title: document.title,
    });
  }, [locationPath]);
}
