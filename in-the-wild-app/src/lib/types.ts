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
  venue_match_alerts?: boolean;
  is_admin: boolean;
  compatibility_pct?: number;
  interest_match_pct?: number;
  vicinity_pct?: number;
  shared_interests?: string[];
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
  is_going?: boolean;
  can_plan?: boolean;
};

export type EventPlanOverlap = {
  event: WildEvent;
  other_user: Profile | null;
};

export type Match = {
  id: string;
  other_user: Profile | null;
  event: WildEvent | null;
  matched_at: string;
  chat_expires_at: string;
  status: string;
  seconds_remaining: number;
  can_send?: boolean;
  can_read?: boolean;
  other_id_verified?: boolean;
  block_reason?: string | null;
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
  dev_lounge: 'Dev test',
};

export type AdminStats = {
  users: number;
  events: number;
  activeMatches: number;
  reports: number;
  waitlist: number;
};

export type AdminReport = {
  id: string;
  reason: string;
  status: 'pending' | 'dismissed' | 'actioned';
  reviewed_at: string | null;
  created_at: string;
  reporter: Profile | null;
  reported: Profile | null;
};

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
