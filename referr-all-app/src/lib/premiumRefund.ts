import type { PremiumRefundPreview } from './api';

export const PREMIUM_REFUND_BLOCK_MESSAGES: Record<string, string> = {
  below_minimum_refund: 'The prorated refund would be under $1.00, so no card refund is issued.',
  featured_purchase_too_recent:
    'Featured status was activated recently. Wait at least 15 minutes before a refund-eligible delete.',
  refund_rate_limit: 'Too many featured refunds on your account in the last 24 hours.',
  already_refunded: 'This featured purchase was already refunded.',
  no_payment_intent: 'No refundable featured payment is on file for this post.',
  premium_expired: 'Featured time has already expired — no refund applies.',
  not_featured: 'This post is not featured — no refund applies.',
};

export function premiumRefundBlockedMessage(code: string | null | undefined): string {
  if (!code) return 'No featured refund applies to this deletion.';
  return PREMIUM_REFUND_BLOCK_MESSAGES[code] || `No refund: ${code}`;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function prorationLabel(preview: PremiumRefundPreview): string {
  const bd = preview.breakdown;
  if (!bd) return '';
  if (bd.prorationBasis === 'days_remaining') {
    return `Prorated by ${bd.daysRemaining} of ${bd.totalDays} days remaining`;
  }
  return `Prorated excluding ${bd.daysUsed} of ${bd.totalDays} days used`;
}
