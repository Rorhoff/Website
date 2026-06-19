import ReactGA from 'react-ga4';

let initialized = false;

export function getGa4MeasurementId(): string | undefined {
  const id = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim();
  return id || undefined;
}

export function initGa4(): void {
  const measurementId = getGa4MeasurementId();
  if (!measurementId || initialized) return;
  ReactGA.initialize(measurementId, {
    gaOptions: { send_page_view: false },
  });
  initialized = true;
}

export function isGa4Initialized(): boolean {
  return initialized;
}
