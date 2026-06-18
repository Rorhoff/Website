import type {
  AccountSession, AccountSettings, Connection, Conversation, Message, Post, Profile,
  PurchaseRecord, SeekerPost,
} from './types';
import {
  BASE_PREMIUM_PRICE_CENTS,
  PREMIUM_DURATION_DAYS,
  PREMIUM_TIER1_COUNT,
  PREMIUM_TIER1_INCREMENT_CENTS,
  PREMIUM_TIER2_COUNT,
  PREMIUM_TIER2_INCREMENT_CENTS,
  PREMIUM_TIER3_INCREMENT_CENTS,
  computePremiumPriceCents,
} from './types';

export * from './types';

const TOKEN_KEY = 'referr_all_token';
const API = '/api/referr-all';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: string }).detail;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${res.status})`);
  }
  return data as T;
}

export async function register(input: {
  email: string;
  password: string;
  username: string;
  fullName: string;
}): Promise<{ token: string; profile: Profile }> {
  const data = await request<{ token: string; profile: Profile }>(
    '/register',
    { method: 'POST', body: JSON.stringify(input) },
    false,
  );
  setToken(data.token);
  return data;
}

export type LoginResult =
  | { token: string; profile: Profile; twofaRequired?: false }
  | { twofaRequired: true; twofaToken: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const data = await request<LoginResult>(
    '/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false,
  );
  if ('token' in data && data.token) setToken(data.token);
  return data;
}

export async function loginVerify2fa(twofaToken: string, code: string): Promise<{ token: string; profile: Profile }> {
  const data = await request<{ token: string; profile: Profile }>(
    '/login/2fa',
    { method: 'POST', body: JSON.stringify({ twofaToken, code }) },
    false,
  );
  setToken(data.token);
  return data;
}

export async function forgotPassword(email: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    '/password/forgot',
    { method: 'POST', body: JSON.stringify({ email }) },
    false,
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    '/password/reset',
    { method: 'POST', body: JSON.stringify({ token, password: newPassword }) },
    false,
  );
}

export async function logout() {
  try {
    await request('/logout', { method: 'POST' });
  } finally {
    setToken(null);
  }
}

export async function fetchMe(): Promise<Profile> {
  return request<Profile>('/me');
}

export async function updateProfile(body: Record<string, unknown>): Promise<Profile> {
  return request<Profile>('/me', { method: 'PATCH', body: JSON.stringify(body) });
}

export async function listProfiles(): Promise<Profile[]> {
  return request<Profile[]>('/profiles');
}

export async function getProfile(id: string): Promise<Profile> {
  return request<Profile>(`/profiles/${id}`);
}

export async function listPosts(): Promise<Post[]> {
  return request<Post[]>('/posts');
}

export async function createPost(body: Record<string, unknown>): Promise<Post> {
  return request<Post>('/posts', { method: 'POST', body: JSON.stringify(body) });
}

export async function deletePost(id: string) {
  return request(`/posts/${id}`, { method: 'DELETE' });
}

export async function reportPost(id: string): Promise<{ ok: boolean; alreadyReported: boolean; removed: boolean }> {
  return request(`/posts/${id}/report`, { method: 'POST' });
}

export async function checkPostReported(id: string): Promise<{ reported: boolean }> {
  return request(`/posts/${id}/reported`);
}

export async function listSeekerPosts(): Promise<SeekerPost[]> {
  return request<SeekerPost[]>('/seeker-posts');
}

export async function createSeekerPost(body: Record<string, unknown>): Promise<SeekerPost> {
  return request<SeekerPost>('/seeker-posts', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteSeekerPost(id: string): Promise<{
  ok: boolean;
  refundCents?: number;
  refundEligible?: boolean;
  refundBlockedReason?: string | null;
}> {
  return request(`/seeker-posts/${id}`, { method: 'DELETE' });
}

export async function reportSeekerPost(id: string): Promise<{ ok: boolean; alreadyReported: boolean; removed: boolean }> {
  return request(`/seeker-posts/${id}/report`, { method: 'POST' });
}

export async function checkSeekerPostReported(id: string): Promise<{ reported: boolean }> {
  return request(`/seeker-posts/${id}/reported`);
}

export async function listConnections(): Promise<Connection[]> {
  return request<Connection[]>('/connections');
}

export async function createConnection(addresseeId: string): Promise<Connection> {
  return request<Connection>('/connections', {
    method: 'POST',
    body: JSON.stringify({ addresseeId }),
  });
}

export async function updateConnection(id: string, status: string): Promise<Connection> {
  return request<Connection>(`/connections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteConnection(id: string) {
  return request(`/connections/${id}`, { method: 'DELETE' });
}

export async function checkBlock(blockedId: string): Promise<{ blocked: boolean; id: string | null }> {
  return request(`/blocks/check/${blockedId}`);
}

export async function createBlock(blockedId: string) {
  return request('/blocks', { method: 'POST', body: JSON.stringify({ blockedId }) });
}

export async function deleteBlock(blockedId: string) {
  return request(`/blocks/${blockedId}`, { method: 'DELETE' });
}

export type BlockEntry = {
  id: string;
  blocked_id: string;
  created_at: string;
  profile?: Profile | null;
};

export async function listBlocks(): Promise<BlockEntry[]> {
  return request<BlockEntry[]>('/blocks');
}

export async function listConversations(): Promise<Conversation[]> {
  return request<Conversation[]>('/conversations');
}

export async function createConversation(otherUserId: string): Promise<{ id: string }> {
  return request('/conversations', {
    method: 'POST',
    body: JSON.stringify({ otherUserId }),
  });
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${conversationId}/messages`);
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
  return request<Message>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function uploadAvatar(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request<{ url: string }>('/uploads/avatar', { method: 'POST', body: form });
}

export async function uploadBanner(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request<{ url: string }>('/uploads/banner', { method: 'POST', body: form });
}

export type ReferrallStatus = {
  paymentsConfigured: boolean;
  imageStorageConfigured: boolean;
  authDbReady: boolean;
  authDbError: string | null;
  premiumDbReady: boolean;
  premiumDbError: string | null;
  usaOnly: boolean;
  missingPaymentEnv: string[];
  paymentsSetupHint: string;
};

export async function getReferrallStatus(): Promise<ReferrallStatus> {
  return request<ReferrallStatus>('/status', {}, false);
}

export type PremiumPriceInfo = {
  priceCents: number;
  activeFeaturedCount: number;
  purchaseNumber: number;
  priorPurchases30d: number;
  durationDays: number;
};

export async function getPremiumPrice(): Promise<PremiumPriceInfo> {
  return request<PremiumPriceInfo>('/premium/price');
}

export async function getCurrentPremiumPriceCents(): Promise<number> {
  const data = await getPremiumPrice();
  return data.priceCents;
}

export async function createPremiumCheckout(input: {
  seekerPostId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  return request('/premium/checkout', { method: 'POST', body: JSON.stringify(input) });
}

export function premiumCheckoutSuccessUrl(origin = window.location.origin): string {
  return `${origin}/referr-all/?featured=1&session_id={CHECKOUT_SESSION_ID}`;
}

export async function confirmPremiumCheckout(sessionId: string): Promise<{ seekerPostId: string; isPremium?: boolean }> {
  return request('/premium/confirm', { method: 'POST', body: JSON.stringify({ sessionId }) });
}

export async function reconcilePremiumPayments(): Promise<{ activated: number; results: { seekerPostId: string; isPremium?: boolean }[] }> {
  return request('/premium/reconcile', { method: 'POST' });
}

// --- Account & security settings ---

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; token: string }> {
  const data = await request<{ ok: boolean; token: string }>(
    '/account/password',
    { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
  );
  if (data.token) setToken(data.token);
  return data;
}

export async function changeEmail(password: string, newEmail: string): Promise<{ ok: boolean; profile: Profile; verificationSent: boolean }> {
  return request('/account/email', { method: 'POST', body: JSON.stringify({ password, newEmail }) });
}

export async function setPhone(phone: string): Promise<{ ok: boolean; profile: Profile }> {
  return request('/account/phone', { method: 'POST', body: JSON.stringify({ phone }) });
}

export async function updateAccountSettings(settings: AccountSettings): Promise<{ ok: boolean; settings: AccountSettings }> {
  return request('/account/settings', { method: 'PATCH', body: JSON.stringify({ settings }) });
}

export async function twoFactorSetup(): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
  return request('/account/2fa/setup');
}

export async function twoFactorEnable(secret: string, code: string): Promise<{ ok: boolean }> {
  return request('/account/2fa/enable', {
    method: 'POST',
    headers: { 'X-2FA-Secret': secret },
    body: JSON.stringify({ code }),
  });
}

export async function twoFactorDisable(password: string, code?: string): Promise<{ ok: boolean }> {
  return request('/account/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) });
}

export async function listSessions(): Promise<AccountSession[]> {
  return request<AccountSession[]>('/account/sessions');
}

export async function revokeSession(id: string): Promise<{ ok: boolean }> {
  return request(`/account/sessions/${id}`, { method: 'DELETE' });
}

export async function revokeOtherSessions(): Promise<{ ok: boolean }> {
  return request('/account/sessions/revoke-others', { method: 'POST' });
}

export async function listPurchases(): Promise<PurchaseRecord[]> {
  return request<PurchaseRecord[]>('/account/purchases');
}

export async function deactivateAccount(password: string): Promise<{ ok: boolean }> {
  return request('/account/deactivate', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function deleteAccount(password: string): Promise<{ ok: boolean }> {
  return request('/account', { method: 'DELETE', body: JSON.stringify({ password, confirm: 'DELETE' }) });
}

export {
  BASE_PREMIUM_PRICE_CENTS,
  PREMIUM_DURATION_DAYS,
  PREMIUM_TIER1_COUNT,
  PREMIUM_TIER1_INCREMENT_CENTS,
  PREMIUM_TIER2_COUNT,
  PREMIUM_TIER2_INCREMENT_CENTS,
  PREMIUM_TIER3_INCREMENT_CENTS,
  computePremiumPriceCents,
};
