const SEEN_KEY = 'itw_seen_event_overlaps';

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: string[]) {
  const seen = readSeen();
  ids.forEach(id => seen.add(id));
  const trimmed = [...seen].slice(-200);
  localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
}

export function overlapKey(eventId: string, otherUserId: string): string {
  return `${eventId}:${otherUserId}`;
}

export function filterUnseenOverlaps(keys: string[]): string[] {
  const seen = readSeen();
  return keys.filter(k => !seen.has(k));
}

export function markOverlapsSeen(keys: string[]) {
  if (keys.length) writeSeen(keys);
}
