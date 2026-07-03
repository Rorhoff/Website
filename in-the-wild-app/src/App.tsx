import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import EventPlanOverlapModal from './components/EventPlanOverlapModal';
import VenueMatchModal from './components/VenueMatchModal';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import DiscoverPage from './pages/DiscoverPage';
import EventsPage from './pages/EventsPage';
import MatchesPage from './pages/MatchesPage';
import ChatPage from './pages/ChatPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import { useEventPlanAlerts } from './hooks/useEventPlanAlerts';
import { useMatchAlerts } from './hooks/useMatchAlerts';
import { markMatchesSeen } from './lib/matchAlerts';
import type { Match } from './lib/types';
import { Leaf } from 'lucide-react';
import {
  type AppNavState,
  type AppPage,
  defaultNavState,
  parseNavHash,
  pushNavState,
  readHistoryNavState,
} from './lib/appNav';

type Screen = 'landing' | 'auth' | 'app';

export type MatchAlertBridge = {
  onNewMatches: (matches: Match[]) => void;
};

function AppInner() {
  const { profile, loading, refreshProfile } = useAuth();
  const [screen, setScreen] = useState<Screen>('landing');
  const [page, setPage] = useState<AppPage>('discover');
  const [matchId, setMatchId] = useState<string | null>(null);
  const navSynced = useRef(false);
  const { alertMatches, notifyFromResponse, dismissAlerts } = useMatchAlerts(!!profile);
  const {
    alertOverlaps,
    notifyFromResponse: notifyOverlapsFromResponse,
    dismissAlerts: dismissOverlapAlerts,
  } = useEventPlanAlerts();

  const applyNav = useCallback((state: AppNavState) => {
    setPage(state.page);
    setMatchId(state.matchId);
  }, []);

  const commitNav = useCallback((next: AppNavState, replace = false) => {
    applyNav(next);
    pushNavState(next, replace);
  }, [applyNav]);

  useEffect(() => {
    if (loading) return;
    if (profile) {
      setScreen('app');
    } else if (window.location.hash.includes('auth')) {
      setScreen('auth');
    }
  }, [loading, profile]);

  useEffect(() => {
    if (loading || !profile) return;
    if (page === 'admin' && !profile.is_admin) {
      commitNav({ page: 'discover', matchId: null }, true);
    }
  }, [loading, profile, page, commitNav]);

  useEffect(() => {
    if (loading || !profile) return;

    const onPop = (event: PopStateEvent) => {
      const state = (event.state as AppNavState | null) ?? parseNavHash() ?? defaultNavState();
      applyNav(state);
    };
    window.addEventListener('popstate', onPop);

    if (!navSynced.current) {
      const initial = readHistoryNavState();
      applyNav(initial);
      pushNavState(initial, !window.history.state?.page);
      navSynced.current = true;
    }

    return () => window.removeEventListener('popstate', onPop);
  }, [loading, profile, applyNav]);

  function navigateTo(pageId: AppPage) {
    commitNav({ page: pageId, matchId: null });
  }

  function openChat(id: string) {
    markMatchesSeen([id]);
    dismissAlerts();
    commitNav({ page: 'chat', matchId: id });
  }

  function handleOpenChatFromModal(id: string) {
    openChat(id);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center">
            <Leaf size={24} className="text-white" />
          </div>
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!profile) {
    if (screen === 'auth') {
      return (
        <AuthPage
          onBack={() => setScreen('landing')}
          onSuccess={() => {
            refreshProfile();
            setScreen('app');
          }}
        />
      );
    }
    return <LandingPage onTryBeta={() => setScreen('auth')} />;
  }

  const content =
    page === 'discover' ? (
      <DiscoverPage
        onNewMatches={notifyFromResponse}
        onNewOverlaps={notifyOverlapsFromResponse}
        onOpenProfile={() => navigateTo('profile')}
      />
    ) :
    page === 'events' ? (
      <EventsPage
        onNewMatches={notifyFromResponse}
        onNewOverlaps={notifyOverlapsFromResponse}
      />
    ) :
    page === 'matches' ? <MatchesPage onOpenChat={openChat} /> :
    page === 'chat' && matchId ? <ChatPage matchId={matchId} onBack={() => navigateTo('matches')} /> :
    page === 'profile' ? (
      <ProfilePage
        onOpenAdmin={() => navigateTo('admin')}
        onNewOverlaps={notifyOverlapsFromResponse}
      />
    ) :
    page === 'admin' ? <AdminPage onBack={() => navigateTo('profile')} /> :
    <DiscoverPage
      onNewMatches={notifyFromResponse}
      onNewOverlaps={notifyOverlapsFromResponse}
    />;

  return (
    <>
      <Layout currentPage={page} onNavigate={navigateTo}>
        {content}
      </Layout>
      {alertMatches.length > 0 && (
        <VenueMatchModal
          matches={alertMatches}
          onClose={dismissAlerts}
          onOpenChat={handleOpenChatFromModal}
        />
      )}
      {alertOverlaps.length > 0 && (
        <EventPlanOverlapModal
          overlaps={alertOverlaps}
          onClose={dismissOverlapAlerts}
          onViewEvents={() => {
            dismissOverlapAlerts();
            navigateTo('events');
          }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
