export type AppPage = 'feed' | 'network' | 'messages' | 'profile' | 'settings' | 'terms' | 'privacy';

export type NavSnapshot = { page: AppPage; viewingUserId: string | null };

export type AppNavState = {
  page: AppPage;
  viewingUserId: string | null;
  messageUserId: string | null;
  returnTo: NavSnapshot | null;
};

const PAGES: AppPage[] = ['feed', 'network', 'messages', 'profile', 'settings', 'terms', 'privacy'];

export function defaultNavState(): AppNavState {
  return { page: 'feed', viewingUserId: null, messageUserId: null, returnTo: null };
}

function isAppPage(value: string): value is AppPage {
  return (PAGES as string[]).includes(value);
}

/** Hash route: #/feed, #/profile/{id}, #/messages/{id}, etc. */
export function navStateToHash(state: AppNavState): string {
  const { page, viewingUserId, messageUserId } = state;
  if (page === 'profile' && viewingUserId) return `#/profile/${encodeURIComponent(viewingUserId)}`;
  if (page === 'messages' && messageUserId) return `#/messages/${encodeURIComponent(messageUserId)}`;
  return `#/${page}`;
}

export function parseNavHash(hash = window.location.hash): AppNavState | null {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (!raw) return null;
  const segments = raw.split('/').filter(Boolean);
  const page = segments[0];
  if (!isAppPage(page)) return null;
  const state = defaultNavState();
  state.page = page;
  if (page === 'profile' && segments[1]) {
    state.viewingUserId = decodeURIComponent(segments[1]);
  }
  if (page === 'messages' && segments[1]) {
    state.messageUserId = decodeURIComponent(segments[1]);
  }
  return state;
}

export function navStateToUrl(state: AppNavState): string {
  const base = `${window.location.pathname}${window.location.search}`;
  const pathOnly = base.split('?')[0] || '/';
  const hash = navStateToHash(state);
  return `${pathOnly}${hash}`;
}

export function readHistoryNavState(): AppNavState {
  const fromState = window.history.state as AppNavState | null;
  if (fromState?.page && isAppPage(fromState.page)) {
    return {
      page: fromState.page,
      viewingUserId: fromState.viewingUserId ?? null,
      messageUserId: fromState.messageUserId ?? null,
      returnTo: fromState.returnTo ?? null,
    };
  }
  return parseNavHash() ?? defaultNavState();
}

export function pushNavState(state: AppNavState, replace = false): void {
  const url = navStateToUrl(state);
  if (replace) {
    window.history.replaceState(state, '', url);
  } else {
    window.history.pushState(state, '', url);
  }
}

/** After external redirects (Stripe, email links), drop off-site history entries when possible. */
export function replaceNavAfterExternalReturn(state: AppNavState = defaultNavState()): void {
  const url = navStateToUrl(state);
  window.history.replaceState(state, '', url);
}

export type AuthHashView = 'login' | 'register';

/** Logged-out routes: #/login, #/register (UTMs stay in ?query before the hash). */
export function parseAuthHash(hash = window.location.hash): AuthHashView {
  const raw = hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (raw === 'register') return 'register';
  return 'login';
}

export function authHashForView(view: AuthHashView): string {
  return view === 'register' ? '#/register' : '#/login';
}

export function replaceAuthHash(view: AuthHashView): void {
  const base = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', `${base}${authHashForView(view)}`);
}
