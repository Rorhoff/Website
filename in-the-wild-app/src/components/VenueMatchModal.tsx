import { Clock, Heart, MessageCircle, X } from 'lucide-react';
import type { Match } from '../lib/types';
import { formatCountdown } from '../lib/types';

type Props = {
  matches: Match[];
  onClose: () => void;
  onOpenChat: (matchId: string) => void;
};

export default function VenueMatchModal({ matches, onClose, onOpenChat }: Props) {
  const match = matches[0];
  if (!match) return null;

  const name = match.other_user?.display_name || 'Someone';
  const eventName = match.event?.name || 'this event';

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-stone-900 border border-emerald-700/50 rounded-3xl p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-500 hover:text-stone-300 p-1"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-emerald-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Heart size={32} className="text-emerald-400" fill="currentColor" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">You&apos;re both nearby!</h2>
          <p className="text-stone-400 text-sm leading-relaxed">
            You and <span className="text-white font-medium">{name}</span> are within 100 feet at{' '}
            <span className="text-emerald-400">{eventName}</span>.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-amber-400 text-sm mb-6">
          <Clock size={16} />
          <span>{formatCountdown(match.seconds_remaining)} left to coordinate — then say hi in person</span>
        </div>

        {matches.length > 1 && (
          <p className="text-stone-500 text-xs text-center mb-4">
            +{matches.length - 1} more match{matches.length > 2 ? 'es' : ''} waiting in Matches
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium hover:bg-stone-800 transition"
          >
            Not now
          </button>
          <button
            onClick={() => onOpenChat(match.id)}
            className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
          >
            <MessageCircle size={18} />
            Open chat
          </button>
        </div>
      </div>
    </div>
  );
}
