import { type ReactNode } from 'react';
import { Compass, MapPin, Heart, User, LogOut, Leaf } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { AppPage } from '../lib/appNav';

type Props = {
  children: ReactNode;
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
};

export default function Layout({ children, currentPage, onNavigate }: Props) {
  const { profile, signOut } = useAuth();

  const navItems: { id: AppPage; label: string; icon: typeof Compass }[] = [
    { id: 'discover', label: 'Discover', icon: Compass },
    { id: 'events', label: 'Events', icon: MapPin },
    { id: 'matches', label: 'Matches', icon: Heart },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="min-h-screen bg-stone-950 overflow-x-hidden">
      <header className="itw-fixed-header fixed top-0 left-0 right-0 z-50 bg-stone-950/95 backdrop-blur border-b border-stone-800">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => onNavigate('discover')} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
              <Leaf size={16} className="text-white" />
            </div>
            <span className="text-white font-bold text-sm tracking-tight">In the Wild</span>
          </button>
          <button
            onClick={() => signOut()}
            className="text-stone-500 hover:text-stone-300 p-2 rounded-lg transition"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="itw-main-offset max-w-lg mx-auto px-4 pb-24 pt-4 min-h-screen">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-stone-950/95 backdrop-blur border-t border-stone-800 pb-safe">
        <div className="max-w-lg mx-auto flex">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition ${
                currentPage === id || (currentPage === 'chat' && id === 'matches')
                  ? 'text-emerald-400'
                  : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              <Icon size={20} />
              {label}
              {id === 'events' && profile?.active_check_in?.open_to_meet && (
                <span className="absolute top-2 w-2 h-2 bg-emerald-400 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
