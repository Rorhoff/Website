const RECENT_KEY = "mw_mapbuilder_recent";
const SESSION_KEY = "mw_mapbuilder_session";
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

/** Last open map — survives refresh so sprite uploads and edits are not lost. */
export function saveEditorSession(json: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, json);
  } catch {
    /* quota / private mode */
  }
}

export function loadEditorSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
