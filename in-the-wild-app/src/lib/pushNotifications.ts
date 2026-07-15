import * as api from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'web';
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** True when launched as an installed home-screen web app (required for iOS push). */
export function isStandalonePwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
  );
}

function serviceWorkerScope(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const scope = serviceWorkerScope();
    const existing = await navigator.serviceWorker.getRegistration(scope);
    if (existing) return existing;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`${serviceWorkerScope()}sw.js`);
  } catch {
    return null;
  }
}

const IOS_HOMESCREEN_HINT =
  'Alerts saved for email. For push on iPhone: Share → Add to Home Screen in Safari, then open In the Wild from that icon (not Safari) and enable alerts again.';

export async function subscribeToPushNotifications(): Promise<{ ok: boolean; message: string }> {
  if (isIos() && !isStandalonePwa()) {
    return { ok: true, message: IOS_HOMESCREEN_HINT };
  }

  const reg = await registerServiceWorker();
  if (!reg) {
    return {
      ok: true,
      message: isIos()
        ? IOS_HOMESCREEN_HINT
        : 'Alerts saved for email. Add In the Wild to your home screen for push on mobile.',
    };
  }

  if (!('Notification' in window)) {
    return {
      ok: true,
      message: isIos()
        ? IOS_HOMESCREEN_HINT
        : 'Alerts saved for email. This browser does not support push notifications.',
    };
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return {
      ok: true,
      message:
        perm === 'denied'
          ? 'Alerts saved for email. Notifications are blocked in Settings → Notifications → In the Wild.'
          : 'Alerts saved for email. Allow notifications when prompted for push alerts.',
    };
  }

  const config = await api.fetchNotificationConfig();
  if (!config.vapid_public_key || !reg.pushManager) {
    return {
      ok: true,
      message: 'Alerts saved. You will get email and in-app alerts when a match is within 100 feet.',
    };
  }

  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key) as BufferSource,
      });
    }
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: true, message: 'Alerts saved. Push will activate when the app is installed.' };
    }
    await api.subscribePush({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      platform: detectPlatform(),
    });
    return { ok: true, message: '' };
  } catch {
    return {
      ok: true,
      message: isIos() ? IOS_HOMESCREEN_HINT : 'Alerts saved for email. Push could not be registered on this device.',
    };
  }
}

export async function unsubscribeFromPushNotifications(): Promise<void> {
  try {
    await api.unsubscribePush();
  } catch {
    /* ignore */
  }
  try {
    const reg = await getServiceWorkerRegistration();
    if (!reg?.pushManager) return;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* ignore — e.g. Safari tab has no pushManager */
  }
}
