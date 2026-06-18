import * as api from './api';
import type { SeekerPost } from './types';

export const PENDING_PREMIUM_SESSION_KEY = 'referr_all_pending_premium_session';

export function isPremiumActive(post: Pick<SeekerPost, 'is_premium' | 'premium_expires_at'>): boolean {
  if (!post.is_premium) return false;
  if (!post.premium_expires_at) return true;
  return new Date(post.premium_expires_at) > new Date();
}

export function storePendingPremiumSession(sessionId: string) {
  localStorage.setItem(PENDING_PREMIUM_SESSION_KEY, sessionId);
}

export function clearPendingPremiumSession() {
  localStorage.removeItem(PENDING_PREMIUM_SESSION_KEY);
}

/**
 * On referr-all.com prod the SPA lives at / but older builds sent Stripe back to /referr-all/.
 * Redirect before React mounts so the user never sits on a JSON 404 page.
 * Returns true if a full-page redirect was started.
 */
export function redirectLegacyStripeReturnPath(): boolean {
  const base = import.meta.env.BASE_URL || '/';
  if (base !== '/') return false;
  const { pathname, search, origin } = window.location;
  if (pathname !== '/referr-all' && !pathname.startsWith('/referr-all/')) return false;
  window.location.replace(`${origin}/${search || ''}`);
  return true;
}

/** Persist session_id from the return URL so confirm still works after redirect/login. */
export function capturePremiumSessionFromUrl(): void {
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  if (sessionId) storePendingPremiumSession(sessionId);
}

async function tryActivatePremium(sessionId?: string | null): Promise<boolean> {
  if (sessionId) {
    try {
      const result = await api.confirmPremiumCheckout(sessionId);
      if (result.isPremium) return true;
    } catch {
      /* fall through to reconcile */
    }
  }
  try {
    const synced = await api.reconcilePremiumPayments();
    return synced.activated > 0;
  } catch {
    return false;
  }
}

/** Confirm Stripe checkout after redirect (URL param or stored session id). */
export async function confirmPremiumReturn(): Promise<{
  confirmed: boolean;
  featuredReturn: boolean;
  error?: string;
}> {
  const params = new URLSearchParams(window.location.search);
  const featuredReturn = params.get('featured') === '1';
  const sessionId = params.get('session_id') || localStorage.getItem(PENDING_PREMIUM_SESSION_KEY);

  if (featuredReturn) {
    window.history.replaceState({}, '', new URL(api.appHomeUrl()).pathname);
  }

  if (!sessionId && !featuredReturn) {
    return { confirmed: false, featuredReturn: false };
  }

  try {
    const activated = await tryActivatePremium(sessionId);
    clearPendingPremiumSession();
    if (activated) {
      return { confirmed: true, featuredReturn };
    }
    if (featuredReturn || sessionId) {
      return {
        confirmed: false,
        featuredReturn,
        error: 'Payment received but featured status could not be activated. Try "Restore featured status" on Profile or contact support.',
      };
    }
    return { confirmed: false, featuredReturn };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not activate featured status';
    return { confirmed: false, featuredReturn, error: message };
  }
}
