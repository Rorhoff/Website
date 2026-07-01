export type AppPage = 'discover' | 'events' | 'matches' | 'chat' | 'profile' | 'admin';

export type AppNavState = {
  page: AppPage;
  matchId: string | null;
};

export function defaultNavState(): AppNavState {
  return { page: 'discover', matchId: null };
}

export function parseNavHash(): AppNavState | null {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (!raw) return null;
  const parts = raw.split('/');
  const page = parts[0] as AppPage;
  if (page === 'chat' && parts[1]) {
    return { page: 'chat', matchId: parts[1] };
  }
  if (['discover', 'events', 'matches', 'profile', 'admin'].includes(page)) {
    return { page, matchId: null };
  }
  return null;
}

export function navStateToUrl(state: AppNavState): string {
  if (state.page === 'chat' && state.matchId) return `#/chat/${state.matchId}`;
  return `#/${state.page}`;
}

export function pushNavState(state: AppNavState, replace = false) {
  const url = navStateToUrl(state);
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method](state, '', url);
}

export function readHistoryNavState(): AppNavState {
  const fromState = window.history.state as AppNavState | null;
  if (fromState?.page) return fromState;
  return parseNavHash() ?? defaultNavState();
}
