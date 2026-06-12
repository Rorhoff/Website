export type Profile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  bio: string;
  company: string;
  role: string;
  location: string;
  linkedin_url: string;
  portfolio_url: string;
  years_experience: number;
  skills: string[];
  interests: string[];
  is_suspended: boolean;
  created_at: string;
  updated_at: string;
  email?: string;
};

export type Post = {
  id: string;
  author_id: string;
  company: string;
  role_title: string;
  description: string;
  referral_bonus: string;
  has_bonus: boolean;
  job_url: string;
  location: string;
  is_remote: boolean;
  tags: string[];
  required_skills: string[];
  created_at: string;
  updated_at: string;
  profiles?: Profile;
};

export type Connection = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  updated_at: string;
  requester?: Profile;
  addressee?: Profile;
};

export type Conversation = {
  id: string;
  created_at: string;
  updated_at: string;
  otherUser?: Profile;
  lastMessage?: Message;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: Profile;
};

export type SeekerPost = {
  id: string;
  author_id: string;
  headline: string;
  about: string;
  desired_role: string;
  desired_location: string;
  open_to_remote: boolean;
  field_of_work: string;
  skills: string[];
  experience_years: number;
  resume_url: string;
  portfolio_url: string;
  availability: 'immediately' | '2weeks' | '1month' | '3months';
  is_premium: boolean;
  premium_expires_at: string | null;
  premium_order: number;
  created_at: string;
  updated_at: string;
  profiles?: Profile;
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  immediately: 'Available Now',
  '2weeks': '2 Weeks Notice',
  '1month': '1 Month Notice',
  '3months': '3+ Months',
};

export const BASE_PREMIUM_PRICE_CENTS = 999;
export const PREMIUM_DURATION_DAYS = 30;
export const PREMIUM_TIER1_COUNT = 5;
export const PREMIUM_TIER1_INCREMENT_CENTS = 1000;
export const PREMIUM_TIER2_COUNT = 5;
export const PREMIUM_TIER2_INCREMENT_CENTS = 2000;
export const PREMIUM_TIER3_INCREMENT_CENTS = 5000;

export function computePremiumPriceCents(priorPurchases: number): number {
  const total = Math.max(0, priorPurchases);
  let price = BASE_PREMIUM_PRICE_CENTS;
  price += Math.min(total, PREMIUM_TIER1_COUNT) * PREMIUM_TIER1_INCREMENT_CENTS;
  price += Math.min(Math.max(total - PREMIUM_TIER1_COUNT, 0), PREMIUM_TIER2_COUNT) * PREMIUM_TIER2_INCREMENT_CENTS;
  price += Math.max(total - PREMIUM_TIER1_COUNT - PREMIUM_TIER2_COUNT, 0) * PREMIUM_TIER3_INCREMENT_CENTS;
  return price;
}
