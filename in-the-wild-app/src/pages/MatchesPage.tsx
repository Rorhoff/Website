import { useCallback, useEffect, useState } from 'react';
import { Clock, Heart, MessageCircle, Sparkles } from 'lucide-react';
import * as api from '../lib/api';
import type { Match, PendingLike } from '../lib/types';
import { formatCountdown } from '../lib/types';

type Props = {
  onOpenChat: (matchId: string) => void;
};

export default function MatchesPage({ onOpenChat }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [pending, setPending] = useState<PendingLike[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [matchRes, likeRes] = await Promise.all([
        api.fetchMatches(),
        api.fetchPendingLikes(),
      ]);
      setMatches(matchRes.matches);
      setPending(likeRes.likes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function cancelLike(userId: string, displayName: string) {
    if (!confirm(`Remove your like for ${displayName}? They may show up in Discover again.`)) return;
    try {
      await api.cancelPendingLike(userId);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not cancel like');
    }
  }

  const active = matches.filter(m => m.status === 'active' && m.seconds_remaining > 0);
  const waiting = pending.filter(l => !l.mutual || !active.some(m => m.other_user?.id === l.user.id));

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Matches</h1>
      <p className="text-stone-500 text-sm mb-6">Unlocked when you&apos;re both at the same event and opted in.</p>

      {loading ? (
        <p className="text-stone-500 text-center py-12">Loading…</p>
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Sparkles size={14} />
                Pending likes
              </h2>
              <div className="space-y-2">
                {waiting.map(like => (
                  <div
                    key={like.user.id}
                    className="flex items-center gap-3 bg-stone-900 border border-stone-800 rounded-xl p-3"
                  >
                    <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {like.user.avatar_url ? (
                        <img src={like.user.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-stone-500 font-bold text-sm">
                          {(like.user.display_name || '?').charAt(0)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{like.user.display_name}</p>
                      <p className="text-stone-500 text-xs">
                        {like.mutual
                          ? 'Mutual like — check in together at an event'
                          : 'Waiting for them to like you back'}
                      </p>
                    </div>
                    {like.mutual && (
                      <span className="text-xs text-emerald-400 font-medium flex-shrink-0">Mutual ♥</span>
                    )}
                    <button
                      type="button"
                      onClick={() => cancelLike(like.user.id, like.user.display_name || like.user.username)}
                      className="text-xs font-medium px-2 py-1 rounded-lg bg-stone-800 text-stone-400 hover:text-red-400 flex-shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {active.length === 0 ? (
            <div className="text-center py-12 bg-stone-900 border border-stone-800 rounded-2xl px-6">
              <p className="text-stone-400 mb-2">No venue matches yet</p>
              <p className="text-stone-600 text-sm">
                Swipe, check in at an event, and turn on Open to Meeting when a mutual like is there too.
              </p>
            </div>
          ) : (
            <section>
              <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Heart size={14} />
                You&apos;re both here
              </h2>
              <div className="space-y-3">
                {active.map(match => (
                  <button
                    key={match.id}
                    onClick={() => onOpenChat(match.id)}
                    className="w-full text-left bg-stone-900 border border-emerald-900/40 hover:border-emerald-700/50 rounded-2xl p-4 transition"
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
                        <p className="text-stone-500 text-xs truncate">{match.event?.name}</p>
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
            </section>
          )}
        </>
      )}
    </div>
  );
}
