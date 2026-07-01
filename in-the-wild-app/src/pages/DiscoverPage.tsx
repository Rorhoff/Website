import { useCallback, useEffect, useState } from 'react';
import { Heart, X, Ban, Flag } from 'lucide-react';
import * as api from '../lib/api';
import type { Match, Profile } from '../lib/types';

type Props = {
  onNewMatches: (matches: Match[]) => void;
};

export default function DiscoverPage({ onNewMatches }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { profiles: p } = await api.fetchDiscover();
      setProfiles(p);
      setIndex(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = profiles[index];

  async function handleSwipe(action: 'like' | 'pass') {
    if (!current) return;
    try {
      const res = await api.swipe(current.id, action);
      if (res.new_matches?.length) {
        onNewMatches(res.new_matches);
      } else if (res.mutual_like) {
        setToast('Mutual like! Check in at an event and turn on Open to Meeting.');
      } else if (action === 'like') {
        setToast('Like saved — meet at a verified event to unlock chat.');
      }
      setIndex(i => i + 1);
      if (index + 1 >= profiles.length - 2) load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Swipe failed');
    }
  }

  async function handleBlock() {
    if (!current || !confirm(`Block @${current.username}?`)) return;
    try {
      await api.blockUser(current.id);
      setToast('Blocked.');
      setIndex(i => i + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Block failed');
    }
  }

  async function handleReport() {
    if (!current) return;
    const reason = window.prompt('Report reason (optional):') ?? '';
    try {
      await api.reportUser(current.id, reason);
      setToast('Report submitted.');
      setIndex(i => i + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Report failed');
    }
  }

  if (loading && !current) {
    return <div className="text-center text-stone-500 py-20">Loading profiles…</div>;
  }

  if (!current) {
    return (
      <div className="text-center py-20">
        <p className="text-stone-400 mb-4">No more profiles right now.</p>
        <button onClick={load} className="text-emerald-400 text-sm font-medium">Refresh</button>
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div className="mb-4 bg-emerald-950/50 border border-emerald-800/50 text-emerald-300 text-sm rounded-xl px-4 py-3">
          {toast}
          <button onClick={() => setToast('')} className="float-right text-emerald-500">×</button>
        </div>
      )}

      <div className="bg-stone-900 border border-stone-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="aspect-[3/4] bg-stone-800 relative">
          {current.avatar_url ? (
            <img src={current.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl font-black text-stone-700">
              {(current.display_name || '?').charAt(0)}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950 via-stone-950/80 to-transparent p-6 pt-20">
            <h2 className="text-2xl font-bold text-white">
              {current.display_name}
              {current.age ? `, ${current.age}` : ''}
            </h2>
            {current.city && <p className="text-stone-400 text-sm">{current.city}</p>}
            {current.bio && <p className="text-stone-300 text-sm mt-2 line-clamp-2">{current.bio}</p>}
            {current.interests?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {current.interests.slice(0, 5).map(i => (
                  <span key={i} className="text-xs bg-stone-800 text-stone-300 px-2.5 py-1 rounded-full">
                    {i}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-4 mt-8">
        <button
          onClick={handleReport}
          title="Report"
          className="w-12 h-12 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center text-stone-500 hover:text-amber-400 transition"
        >
          <Flag size={18} />
        </button>
        <button
          onClick={handleBlock}
          title="Block"
          className="w-12 h-12 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center text-stone-500 hover:text-red-400 transition"
        >
          <Ban size={18} />
        </button>
        <button
          onClick={() => handleSwipe('pass')}
          className="w-16 h-16 rounded-full bg-stone-900 border-2 border-stone-700 flex items-center justify-center text-stone-400 hover:border-red-500 hover:text-red-400 transition"
        >
          <X size={28} />
        </button>
        <button
          onClick={() => handleSwipe('like')}
          className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/50"
        >
          <Heart size={28} fill="currentColor" />
        </button>
      </div>

      <p className="text-center text-stone-600 text-xs mt-6">
        Likes stay silent until you&apos;re both at the same event with &quot;Open to Meeting&quot; on.
      </p>
    </div>
  );
}
