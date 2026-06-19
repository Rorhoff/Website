import ReactGA from 'react-ga4';

let initialized = false;

export type SignupUserType = 'job_seeker' | 'employer';

const UTM_STORAGE_KEY = 'referr_all_utm_params';

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export type UtmParams = Partial<Record<(typeof UTM_KEYS)[number], string>>;

export function getGa4MeasurementId(): string | undefined {
  const id = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim();
  return id || undefined;
}

/** Read UTM query params from the root URL (before the hash) and persist for the session. */
export function captureUtmParamsFromUrl(): void {
  if (typeof window === 'undefined') return;
  const search = new URLSearchParams(window.location.search);
  const incoming: UtmParams = {};
  let hasAny = false;
  for (const key of UTM_KEYS) {
    const value = search.get(key)?.trim();
    if (value) {
      incoming[key] = value;
      hasAny = true;
    }
  }
  if (!hasAny) return;
  const merged = { ...getUtmParams(), ...incoming };
  sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(merged));
}

export function getUtmParams(): UtmParams {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(UTM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: UtmParams = {};
    for (const key of UTM_KEYS) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
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

function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>,
): void {
  if (!initialized) return;
  try {
    ReactGA.event(eventName, params);
  } catch {
    /* GA4 not ready or blocked — ignore */
  }
}

/** Max wait before reload if GA never calls back (ad blockers, network, etc.). */
const SIGNUP_EVENT_TIMEOUT_MS = 1500;

export function trackSignup(userType: SignupUserType): Promise<void> {
  if (!initialized) return Promise.resolve();

  const params: Record<string, string | number | boolean> = {
    user_type: userType,
    ...getUtmParams(),
  };

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timeoutId = window.setTimeout(finish, SIGNUP_EVENT_TIMEOUT_MS);

    try {
      ReactGA.gtag('event', 'sign_up', {
        ...params,
        transport_type: 'beacon',
        event_callback: () => {
          window.clearTimeout(timeoutId);
          finish();
        },
      });
    } catch {
      window.clearTimeout(timeoutId);
      finish();
    }
  });
}

export function trackListingCreated(listingType: string, pricePaid: number): void {
  trackEvent('listing_created', {
    listing_type: listingType,
    price_paid: pricePaid,
  });
}

export function trackMessageSent(): void {
  trackEvent('message_sent');
}

export function trackProfileView(viewedUserId: string): void {
  trackEvent('profile_view', { viewed_user_id: viewedUserId });
}

export function trackReferralSent(): void {
  trackEvent('referral_sent');
}
