import type { Connection, Conversation, Message, Post, Profile, SeekerPost } from './types';
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

export async function login(email: string, password: string): Promise<{ token: string; profile: Profile }> {
  const data = await request<{ token: string; profile: Profile }>(
    '/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false,
  );
  setToken(data.token);
  return data;
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

export type PremiumPriceInfo = {
  priceCents: number;
  purchaseNumber: number;
  priorPurchases30d: number;
  durationDays: number;
  surgeTiers: { throughPurchase: number | null; incrementUsd: number }[];
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
