import { useCallback, useEffect, useState } from 'react';
import { Clock, MessageCircle } from 'lucide-react';
import * as api from '../lib/api';
import { formatCountdown, type Match } from '../lib/types';

type Props = {
  onOpenChat: (matchId: string) => void;
};

export default function MatchesPage({ onOpenChat }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { matches: m } = await api.fetchMatches();
      setMatches(m);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = matches.filter(m => m.status === 'active');

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Matches</h1>
      <p className="text-stone-500 text-sm mb-6">Unlocked when you&apos;re both at the same event and opted in.</p>

      {loading ? (
        <p className="text-stone-500 text-center py-12">Loading…</p>
      ) : active.length === 0 ? (
        <div className="text-center py-16 bg-stone-900 border border-stone-800 rounded-2xl px-6">
          <p className="text-stone-400 mb-2">No venue matches yet</p>
          <p className="text-stone-600 text-sm">
            Swipe, then check in at an event with &quot;Open to Meeting&quot; on when a mutual like is there too.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(match => (
            <button
              key={match.id}
              onClick={() => onOpenChat(match.id)}
              className="w-full text-left bg-stone-900 border border-stone-800 hover:border-emerald-800/50 rounded-2xl p-4 transition"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {match.other_user?.avatar_url ? (
                    <img src={match.other_user.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-stone-500 font-bold">
                      {(match.other_user?.display_name || '?').charAt(0)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">
                    {match.other_user?.display_name || 'Someone'}
                  </p>
                  <p className="text-stone-500 text-xs truncate">
                    {match.event?.name}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-amber-400 text-xs flex items-center gap-1 justify-end">
                    <Clock size={12} />
                    {formatCountdown(match.seconds_remaining)}
                  </p>
                  <MessageCircle size={18} className="text-emerald-400 ml-auto mt-1" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
