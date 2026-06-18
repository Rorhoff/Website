import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthPage from './pages/AuthPage';
import Layout from './components/Layout';
import FeedPage from './pages/FeedPage';
import NetworkPage from './pages/NetworkPage';
import MessagesPage from './pages/MessagesPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import {
  type AppNavState,
  type AppPage,
  defaultNavState,
  parseNavHash,
  pushNavState,
  readHistoryNavState,
} from './lib/appNav';

function AppInner() {
  const { user, profile, loading, signOut } = useAuth();
  const [page, setPage] = useState<AppPage>('feed');
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [messageUserId, setMessageUserId] = useState<string | null>(null);
  const navSynced = useRef(false);

  const applyNavState = useCallback((state: AppNavState) => {
    setPage(state.page);
    setViewingUserId(state.viewingUserId);
    setMessageUserId(state.messageUserId);
  }, []);

  const commitNav = useCallback((next: AppNavState, replace = false) => {
    applyNavState(next);
    pushNavState(next, replace);
  }, [applyNavState]);

  useEffect(() => {
    if (loading || !user || !profile) return;

    const onPop = (event: PopStateEvent) => {
      const state = (event.state as AppNavState | null) ?? parseNavHash() ?? defaultNavState();
      applyNavState(state);
    };

    window.addEventListener('popstate', onPop);

    if (!navSynced.current) {
      const initial = readHistoryNavState();
      applyNavState(initial);
      pushNavState(initial, !window.history.state?.page);
      navSynced.current = true;
    }

    return () => window.removeEventListener('popstate', onPop);
  }, [loading, user, profile, applyNavState]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center">
            <span className="text-white font-black text-xl">RA</span>
          </div>
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <AuthPage />;
  }

  if (profile.is_suspended) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="bg-gray-900 border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-400 text-2xl font-bold">!</span>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Account Suspended</h1>
          <p className="text-gray-400 text-sm mb-6">
            Your account has been permanently suspended due to violations of our community guidelines (Ten-Block Rule).
            This decision is final and is not subject to appeal.
          </p>
          <button
            onClick={() => signOut()}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl px-6 py-2.5 text-sm transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  function navigate(p: AppPage) {
    commitNav({
      page: p,
      viewingUserId: null,
      messageUserId: null,
      returnTo: null,
    });
  }

  function goBack() {
    window.history.back();
  }

  function handleViewProfile(userId: string) {
    commitNav({
      page: 'profile',
      viewingUserId: userId === user?.id ? null : userId,
      messageUserId: null,
      returnTo: null,
    });
  }

  function openSettings() {
    commitNav({
      page: 'settings',
      viewingUserId,
      messageUserId: null,
      returnTo: null,
    });
  }

  function handleMessage(userId: string) {
    commitNav({
      page: 'messages',
      viewingUserId: null,
      messageUserId: userId,
      returnTo: null,
    });
  }

  return (
    <Layout currentPage={page} onNavigate={navigate}>
      {page === 'feed' && (
        <FeedPage onViewProfile={handleViewProfile} onMessage={handleMessage} />
      )}
      {page === 'network' && (
        <NetworkPage onViewProfile={handleViewProfile} onMessage={handleMessage} />
      )}
      {page === 'messages' && (
        <MessagesPage
          initialUserId={messageUserId}
          onClearInitial={() => setMessageUserId(null)}
        />
      )}
      {page === 'profile' && (
        <ProfilePage
          userId={viewingUserId || user.id}
          onMessage={handleMessage}
          onOpenSettings={openSettings}
          onBack={viewingUserId ? goBack : undefined}
        />
      )}
      {page === 'settings' && (
        <SettingsPage
          onBack={goBack}
          onViewProfile={handleViewProfile}
        />
      )}
      {page === 'terms' && (
        <TermsPage onBack={goBack} />
      )}
      {page === 'privacy' && (
        <PrivacyPage onBack={goBack} />
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
