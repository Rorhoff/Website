import type { AdminReport, AdminStats, ChatMessage, Match, PendingLike, Profile, WildEvent } from './types';

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
  username: string;
  display_name?: string;
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
}> {
  return request('/discover');
}

export async function swipe(
  targetId: string,
  action: 'like' | 'pass',
): Promise<{ mutual_like: boolean; message?: string; new_matches: Match[] }> {
  return request('/swipe', { method: 'POST', body: JSON.stringify({ target_id: targetId, action }) });
}

export async function fetchPendingLikes(): Promise<{ likes: PendingLike[] }> {
  return request('/likes/pending');
}

export async function fetchEvents(): Promise<{ events: WildEvent[] }> {
  return request('/events', {}, false);
}

export async function checkIn(eventId: string, lat: number, lng: number) {
  return request<{ new_matches?: Match[] }>(`/events/${eventId}/check-in`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
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

export async function fetchMessages(matchId: string): Promise<{ messages: ChatMessage[]; chat_expires_at: string }> {
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

export async function fetchVerificationStatus(): Promise<{ id_verified: boolean; can_message: boolean }> {
  return request('/verification/status');
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

export async function fetchAdminUsers(q = ''): Promise<{ users: Profile[] }> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return request(`/admin/users${qs}`);
}

export async function fetchAdminReports(): Promise<{ reports: AdminReport[] }> {
  return request('/admin/reports');
}

export async function patchAdminUser(
  userId: string,
  patch: { id_verified?: boolean; is_suspended?: boolean; is_admin?: boolean },
): Promise<Profile> {
  return request(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
