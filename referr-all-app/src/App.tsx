import { useState } from 'react';
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

type Page = 'feed' | 'network' | 'messages' | 'profile' | 'settings' | 'terms' | 'privacy';

type NavSnapshot = { page: Page; viewingUserId: string | null };

function AppInner() {
  const { user, profile, loading, signOut } = useAuth();
  const [page, setPage] = useState<Page>('feed');
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [messageUserId, setMessageUserId] = useState<string | null>(null);
  const [prevPage, setPrevPage] = useState<Page>('feed');
  const [returnTo, setReturnTo] = useState<NavSnapshot | null>(null);

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
            This decision is final and not subject to appeal.
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

  function navigate(p: Page) {
    if (p === 'terms' || p === 'privacy') {
      setPrevPage(page as Page);
    }
    setReturnTo(null);
    setPage(p);
    // Main nav always shows your own profile; clear any "viewing someone else" id.
    setViewingUserId(null);
    if (p !== 'messages') {
      setMessageUserId(null);
    }
  }

  function goBack() {
    if (returnTo) {
      setPage(returnTo.page);
      setViewingUserId(returnTo.viewingUserId);
      setReturnTo(null);
      if (returnTo.page !== 'messages') {
        setMessageUserId(null);
      }
      return;
    }
    navigate('feed');
  }

  function handleViewProfile(userId: string) {
    if (userId !== user?.id) {
      setReturnTo({ page, viewingUserId });
    }
    setViewingUserId(userId);
    setPage('profile');
  }

  function openSettings() {
    setReturnTo({ page, viewingUserId });
    setPage('settings');
  }

  function handleMessage(userId: string) {
    setReturnTo({ page, viewingUserId });
    setMessageUserId(userId);
    setPage('messages');
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
        <TermsPage onBack={() => setPage(prevPage)} />
      )}
      {page === 'privacy' && (
        <PrivacyPage onBack={() => setPage(prevPage)} />
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
