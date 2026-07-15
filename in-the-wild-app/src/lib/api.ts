import type { AdminReport, AdminStats, AdminMessage, AdminMatch, ChatMessage, EventPlanOverlap, EventsFilterMeta, Match, PendingLike, Profile, WildEvent } from './types';

export * from './types';

const TOKEN_KEY = 'in_the_wild_token';
const API = '/api/in-the-wild';

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

export async function joinWaitlist(input: {
  email: string;
  name?: string;
  city?: string;
}): Promise<{ ok: boolean; message: string }> {
  return request('/waitlist', { method: 'POST', body: JSON.stringify(input) }, false);
}

export async function register(input: {
  email: string;
  password: string;
  display_name: string;
  username?: string;
  birth_year: number;
  gender: string;
  looking_for: string;
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

export async function logout(): Promise<void> {
  try {
    await request('/logout', { method: 'POST' });
  } finally {
    setToken(null);
  }
}

export async function fetchMe(): Promise<Profile> {
  return request('/me');
}

export async function updateProfile(patch: Partial<Profile>): Promise<Profile> {
  return request('/me', { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function fetchDiscover(): Promise<{
  profiles: Profile[];
  needs_preferences?: boolean;
  message?: string;
  hint?: string;
}> {
  return request('/discover');
}

export async function swipe(
  targetId: string,
  action: 'like' | 'pass',
): Promise<{
  mutual_like: boolean;
  message?: string;
  new_matches: Match[];
  new_overlaps?: EventPlanOverlap[];
}> {
  return request('/swipe', { method: 'POST', body: JSON.stringify({ target_id: targetId, action }) });
}

export async function addEventPlan(eventId: string): Promise<{
  ok: boolean;
  is_going: boolean;
  event: WildEvent;
  new_overlaps: EventPlanOverlap[];
}> {
  return request(`/events/${eventId}/plan`, { method: 'POST' });
}

export async function removeEventPlan(eventId: string): Promise<{ ok: boolean; is_going: boolean }> {
  return request(`/events/${eventId}/plan`, { method: 'DELETE' });
}

export async function fetchEventPlans(): Promise<{ plans: Array<{ event_id: string; event: WildEvent }> }> {
  return request('/event-plans');
}

export async function fetchPendingLikes(): Promise<{ likes: PendingLike[] }> {
  return request('/likes/pending');
}

export async function fetchEvents(coords?: { lat: number; lng: number }): Promise<{ events: WildEvent[]; filter: EventsFilterMeta }> {
  const q = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
  return request(`/events${q}`);
}

export async function submitEvent(body: {
  name: string;
  description?: string;
  venue_name: string;
  city: string;
  starts_at: string;
  ends_at: string;
  latitude?: number;
  longitude?: number;
  category?: string;
}): Promise<{ ok: boolean; already_exists: boolean; message: string; event: WildEvent }> {
  return request('/events', { method: 'POST', body: JSON.stringify(body) });
}

export async function checkIn(eventId: string, lat: number, lng: number) {
  return request<{ new_matches?: Match[] }>(`/events/${eventId}/check-in`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  });
}

export async function checkInHere(lat: number, lng: number, venueLabel?: string) {
  return request<{ new_matches?: Match[]; event: WildEvent }>('/check-in/here', {
    method: 'POST',
    body: JSON.stringify({ lat, lng, venue_label: venueLabel?.trim() || '' }),
  });
}

export async function setOpenToMeet(openToMeet: boolean): Promise<{ new_matches: Match[] }> {
  return request('/check-in', {
    method: 'PATCH',
    body: JSON.stringify({ open_to_meet: openToMeet }),
  });
}

export async function leaveCheckIn(): Promise<void> {
  await request('/check-in', { method: 'DELETE' });
}

export async function fetchMatches(): Promise<{ matches: Match[] }> {
  return request('/matches');
}

export async function fetchMessages(matchId: string): Promise<{
  messages: ChatMessage[];
  chat_expires_at: string;
  can_send?: boolean;
  can_read?: boolean;
  other_id_verified?: boolean;
  block_reason?: string | null;
}> {
  return request(`/matches/${matchId}/messages`);
}

export async function sendMessage(matchId: string, body: string): Promise<ChatMessage> {
  return request(`/matches/${matchId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function fetchStatus(): Promise<{ schemaReady: boolean; eventCount: number }> {
  return request('/status', {}, false);
}

export async function uploadAvatar(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request('/uploads/avatar', { method: 'POST', body: form });
}

export async function blockUser(blockedId: string): Promise<void> {
  await request('/blocks', { method: 'POST', body: JSON.stringify({ blocked_id: blockedId }) });
}

export async function reportUser(reportedId: string, reason: string): Promise<void> {
  await request('/reports', {
    method: 'POST',
    body: JSON.stringify({ reported_id: reportedId, reason }),
  });
}

export async function startIdVerification(): Promise<{ status: string; message: string }> {
  return request('/verification/id/start', { method: 'POST' });
}

export async function fetchVerificationStatus(): Promise<{
  id_verified: boolean;
  can_message: boolean;
  requires_both_verified?: boolean;
}> {
  return request('/verification/status');
}

export async function fetchNotificationConfig(): Promise<{
  push_enabled: boolean;
  vapid_public_key: string | null;
  proximity_feet: number;
}> {
  return request('/notifications/config', {}, false);
}

export async function subscribePush(body: {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform?: string;
}): Promise<{ ok: boolean }> {
  return request('/notifications/push/subscribe', { method: 'POST', body: JSON.stringify(body) });
}

export async function unsubscribePush(): Promise<{ ok: boolean }> {
  return request('/notifications/push/subscribe', { method: 'DELETE' });
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return request('/admin/stats');
}

export async function fetchAdminEvents(): Promise<{ events: WildEvent[] }> {
  return request('/admin/events');
}

export async function createAdminEvent(body: Record<string, unknown>): Promise<WildEvent> {
  return request('/admin/events', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateAdminEvent(id: string, body: Record<string, unknown>): Promise<WildEvent> {
  return request(`/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function deleteAdminEvent(id: string): Promise<void> {
  await request(`/admin/events/${id}`, { method: 'DELETE' });
}

export async function fetchAdminUsers(q = '', limit = 200): Promise<{ users: Array<Profile & { email?: string; created_at?: string }> }> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/admin/users${qs}`);
}

export async function fetchAdminMessages(opts?: {
  userId?: string;
  matchId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ messages: AdminMessage[]; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (opts?.userId) params.set('user_id', opts.userId);
  if (opts?.matchId) params.set('match_id', opts.matchId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/admin/messages${qs}`);
}

export async function fetchAdminMatches(opts?: {
  limit?: number;
  offset?: number;
}): Promise<{ matches: AdminMatch[]; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/admin/matches${qs}`);
}

export async function fetchAdminReports(): Promise<{ reports: AdminReport[] }> {
  return request('/admin/reports');
}

export async function patchAdminReport(
  reportId: string,
  action: 'dismiss' | 'suspend_reported',
): Promise<{ ok: boolean; status: string }> {
  return request(`/admin/reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}

export async function patchAdminUser(
  userId: string,
  patch: { id_verified?: boolean; is_suspended?: boolean; is_admin?: boolean },
): Promise<Profile> {
  return request(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
