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

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  } catch {
    return null;
  }
}

export async function subscribeToPushNotifications(): Promise<{ ok: boolean; message: string }> {
  const reg = await registerServiceWorker();
  if (!reg) {
    return {
      ok: false,
      message: 'Add In the Wild to your home screen, then try again for push alerts on iPhone/Android.',
    };
  }

  if (!('Notification' in window)) {
    return {
      ok: false,
      message: 'This browser does not support notifications. Email alerts still work when enabled.',
    };
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return {
      ok: false,
      message:
        perm === 'denied'
          ? 'Notifications blocked in device settings. Alerts are saved — you will still get email when nearby.'
          : 'Notification permission was not granted. Email alerts still work.',
    };
  }

  const config = await api.fetchNotificationConfig();
  if (!config.vapid_public_key || !('PushManager' in window)) {
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
      message: 'Alerts saved. Install from your home screen for push notifications on mobile.',
    };
  }
}

export async function unsubscribeFromPushNotifications(): Promise<void> {
  try {
    await api.unsubscribePush();
  } catch {
    /* ignore */
  }
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}sw.js`);
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  }
}
