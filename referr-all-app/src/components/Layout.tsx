import { ReactNode, useEffect, useState } from 'react';
import { Briefcase, Users, MessageSquare, User, LogOut, Bell, Menu, X, TrendingUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../lib/api';
import type { NotificationSummary } from '../lib/types';

type Page = 'feed' | 'network' | 'messages' | 'profile' | 'settings' | 'admin' | 'terms' | 'privacy';

type Props = {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  profileId?: string;
};

const NOTIFY_POLL_MS = 30_000;

function NavBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function Layout({ children, currentPage, onNavigate }: Props) {
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notify, setNotify] = useState<NotificationSummary | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const load = async () => {
      try {
        const summary = await api.getNotificationSummary();
        if (!cancelled) setNotify(summary);
      } catch {
        /* badge polling is best-effort */
      }
    };
    load();
    const interval = setInterval(load, NOTIFY_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
    // Re-poll on page change so badges clear right after the user acts.
  }, [profile?.id, currentPage]);

  const badgeFor = (page: Page): number => {
    if (!notify) return 0;
    if (page === 'messages') return notify.unreadMessages;
    if (page === 'network') return notify.pendingConnections + notify.referralActions;
    return 0;
  };

  const navItems: { id: Page; label: string; icon: typeof Briefcase }[] = [
    { id: 'feed', label: 'Feed', icon: TrendingUp },
    { id: 'network', label: 'Network', icon: Users },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="min-h-screen bg-gray-950 overflow-x-hidden">
      {/* Top nav */}
      <header className="referr-all-fixed-header fixed top-0 left-0 right-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <button
            onClick={() => onNavigate('feed')}
            className="flex items-center gap-2.5 group"
          >
            <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center group-hover:bg-blue-400 transition-colors">
              <span className="text-white font-black text-base">RA</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight hidden sm:block">Referr-All</span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  currentPage === id
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={17} />
                {label}
                <NavBadge count={badgeFor(id)} />
              </button>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate((notify?.unreadMessages || 0) > 0 ? 'messages' : 'network')}
              title={notify?.total ? `${notify.total} notification${notify.total > 1 ? 's' : ''}` : 'Notifications'}
              className="relative hidden sm:flex w-9 h-9 items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <Bell size={18} />
              {(notify?.total || 0) > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                  {(notify?.total || 0) > 99 ? '99+' : notify?.total}
                </span>
              )}
            </button>

            {profile && (
              <button
                onClick={() => onNavigate('profile')}
                className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
              >
                <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center overflow-hidden">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-blue-400 font-semibold text-sm">
                      {profile.full_name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  )}
                </div>
                <span className="hidden sm:block text-gray-300 text-sm font-medium">{profile.full_name}</span>
              </button>
            )}

            <button
              onClick={() => signOut()}
              className="hidden sm:flex w-9 h-9 items-center justify-center text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden bg-gray-900 border-t border-gray-800 py-2 px-4">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { onNavigate(id); setMobileOpen(false); }}
                className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium transition-all ${
                  currentPage === id
                    ? 'text-blue-400 bg-blue-500/10'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={18} />
                {label}
                <NavBadge count={badgeFor(id)} />
              </button>
            ))}
            <div className="border-t border-gray-800 mt-2 pt-2">
              <button
                onClick={() => signOut()}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-all"
              >
                <LogOut size={18} />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="referr-all-main-offset overflow-x-hidden">
        <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 min-w-0">
          {children}
        </div>

        {/* Footer */}
        <footer className="border-t border-gray-800 mt-8 pb-24 md:pb-8">
          <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-gray-600 text-xs">&copy; 2026 Referr-All. All Rights Reserved.</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => onNavigate('terms')}
                className="text-gray-500 hover:text-gray-300 text-xs transition"
              >
                Terms of Service
              </button>
              <button
                onClick={() => onNavigate('privacy')}
                className="text-gray-500 hover:text-gray-300 text-xs transition"
              >
                Privacy Policy
              </button>
              <a href="mailto:legal@RedA1.com" className="text-gray-500 hover:text-gray-300 text-xs transition">
                Contact
              </a>
            </div>
          </div>
        </footer>
      </main>

      {/* Bottom mobile nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 flex z-50 pb-safe">
        {navItems.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors ${
              currentPage === id ? 'text-blue-400' : 'text-gray-500'
            }`}
          >
            <span className="relative">
              <Icon size={20} />
              {badgeFor(id) > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                  {badgeFor(id) > 99 ? '99+' : badgeFor(id)}
                </span>
              )}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
