import type { ChatMessage, Match, Profile, WildEvent } from './types';

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

export async function fetchDiscover(): Promise<{ profiles: Profile[] }> {
  return request('/discover');
}

export async function swipe(targetId: string, action: 'like' | 'pass'): Promise<{ mutual_like: boolean; message?: string }> {
  return request('/swipe', { method: 'POST', body: JSON.stringify({ target_id: targetId, action }) });
}

export async function fetchEvents(): Promise<{ events: WildEvent[] }> {
  return request('/events', {}, false);
}

export async function checkIn(eventId: string, lat: number, lng: number) {
  return request(`/events/${eventId}/check-in`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  });
}

export async function setOpenToMeet(openToMeet: boolean): Promise<{ new_matches: string[] }> {
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
