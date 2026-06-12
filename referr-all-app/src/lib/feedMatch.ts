import type { Profile } from './types';

/** US state names + common abbreviations for USA-only location checks. */
export const US_LOCATION_TERMS = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
  'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
  'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming', 'district of columbia', 'dc', 'usa', 'u.s.', 'united states',
  ', al', ', ak', ', az', ', ar', ', ca', ', co', ', ct', ', de', ', fl', ', ga', ', hi',
  ', id', ', il', ', in', ', ia', ', ks', ', ky', ', la', ', me', ', md', ', ma', ', mi',
  ', mn', ', ms', ', mo', ', mt', ', ne', ', nv', ', nh', ', nj', ', nm', ', ny', ', nc',
  ', nd', ', oh', ', ok', ', or', ', pa', ', ri', ', sc', ', sd', ', tn', ', tx', ', ut',
  ', vt', ', va', ', wa', ', wv', ', wi', ', wy',
];

/** Hobby / interest keywords mined from bios for lightweight matching. */
const INTEREST_KEYWORDS = [
  'hiking', 'disc golf', 'climbing', 'gaming', 'diablo', 'rick and morty', 'anime',
  'soccer', 'basketball', 'running', 'cycling', 'camping', 'fishing', 'travel',
  'cooking', 'music', 'reading', 'volunteering', 'mentoring', 'open source',
  'machine learning', 'ai', 'startups', 'remote work', 'parent', 'veteran',
];

function normalizeSkill(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.]/g, '').trim();
}

function tokenizeSkills(skills: string[]): string[] {
  return skills.map(normalizeSkill).filter(Boolean);
}

function extractInterestTokens(text: string): string[] {
  const lower = text.toLowerCase();
  return INTEREST_KEYWORDS.filter(kw => lower.includes(kw));
}

function skillOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const skill of a) {
    if (setB.has(skill)) hits += 1;
    else {
      for (const other of b) {
        if (skill.includes(other) || other.includes(skill)) {
          hits += 0.5;
          break;
        }
      }
    }
  }
  return hits;
}

function interestOverlap(viewerBio: string, postText: string): number {
  const viewer = new Set(extractInterestTokens(viewerBio));
  const post = extractInterestTokens(postText);
  if (!viewer.size || !post.length) return 0;
  return post.filter(t => viewer.has(t)).length;
}

/** True when location looks USA-based or the post/user is open to remote US work. */
export function isUsaLocation(location: string, openToRemote = false): boolean {
  const loc = (location || '').trim().toLowerCase();
  if (openToRemote && (!loc || loc === 'remote')) return true;
  if (!loc) return false;
  if (loc === 'remote') return true;
  return US_LOCATION_TERMS.some(term => loc.includes(term));
}

export type MatchInput = {
  skills?: string[];
  about?: string;
  required_skills?: string[];
  desired_role?: string;
  role_title?: string;
  field_of_work?: string;
};

/** Score used to rank feed cards for the signed-in viewer (higher = better fit). */
export function computeMatchScore(viewer: Profile | null | undefined, post: MatchInput): number {
  if (!viewer) return 0;
  const viewerSkills = tokenizeSkills(viewer.skills || []);
  const postSkills = tokenizeSkills([
    ...(post.skills || []),
    ...(post.required_skills || []),
  ]);
  const postText = [post.about, post.desired_role, post.role_title, post.field_of_work]
    .filter(Boolean)
    .join(' ');

  const skills = skillOverlap(viewerSkills, postSkills) * 10;
  const interests = interestOverlap(viewer.bio || '', postText) * 8;
  const roleHint = viewer.role && postText.toLowerCase().includes(viewer.role.toLowerCase()) ? 5 : 0;
  return skills + interests + roleHint;
}

export function matchPercent(score: number): number {
  if (score <= 0) return 0;
  return Math.min(99, Math.round(20 + score * 4));
}
