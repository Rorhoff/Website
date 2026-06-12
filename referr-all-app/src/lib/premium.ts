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
    window.history.replaceState({}, '', window.location.pathname);
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
        error: 'Payment found but featured status could not be activated. Use Sync payments on Profile or fix the Stripe webhook URL.',
      };
    }
    return { confirmed: false, featuredReturn };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not activate featured status';
    return { confirmed: false, featuredReturn, error: message };
  }
}
