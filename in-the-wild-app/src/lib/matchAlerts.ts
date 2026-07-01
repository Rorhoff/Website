const SEEN_KEY = 'itw_seen_match_ids';

export function getSeenMatchIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markMatchesSeen(ids: string[]) {
  const seen = getSeenMatchIds();
  ids.forEach(id => seen.add(id));
  sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

export function filterUnseenMatchIds(ids: string[]): string[] {
  const seen = getSeenMatchIds();
  return ids.filter(id => !seen.has(id));
}
