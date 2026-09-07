const RECENT_KEY = "mw_mapbuilder_recent";
const MAX_RECENT = 8;

export type RecentMapEntry = {
  id: string;
  name: string;
  savedAt: number;
  /** Snapshot JSON — convenience only; file export is source of truth. */
  json: string;
};

export function loadRecentMaps(): RecentMapEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentMapEntry[];
  } catch {
    return [];
  }
}

export function rememberMap(id: string, name: string, json: string): void {
  const list = loadRecentMaps().filter((e) => e.id !== id);
  list.unshift({ id, name, savedAt: Date.now(), json });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

export function removeRecentMap(id: string): void {
  const list = loadRecentMaps().filter((e) => e.id !== id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
