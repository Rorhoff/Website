export type ActiveCheckIn = {
  event_id: string;
  event_name: string;
  open_to_meet: boolean;
  checked_in_at: string;
};

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  birth_year: number | null;
  age: number | null;
  gender: string;
  looking_for: string;
  interests: string[];
  city: string;
  id_verified: boolean;
  background_verified: boolean;
  active_check_in?: ActiveCheckIn | null;
};

export type WildEvent = {
  id: string;
  name: string;
  description: string;
  venue_name: string;
  city: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  category: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type Match = {
  id: string;
  other_user: Profile | null;
  event: WildEvent | null;
  matched_at: string;
  chat_expires_at: string;
  status: string;
  seconds_remaining: number;
};

export type PendingLike = {
  user: Profile;
  mutual: boolean;
  liked_at: string;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  mine: boolean;
};

export const CATEGORY_LABELS: Record<string, string> = {
  festival: 'Festival',
  church: 'Community',
  sports: 'Sports',
  concert: 'Concert',
};

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
