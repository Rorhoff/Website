import { Calendar, Heart, X } from 'lucide-react';
import type { EventPlanOverlap } from '../lib/types';

type Props = {
  overlaps: EventPlanOverlap[];
  onClose: () => void;
  onViewEvents: () => void;
};

export default function EventPlanOverlapModal({ overlaps, onClose, onViewEvents }: Props) {
  const overlap = overlaps[0];
  if (!overlap) return null;

  const name = overlap.other_user?.display_name || 'Someone';
  const eventName = overlap.event?.name || 'an event';

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-stone-900 border border-sky-700/50 rounded-3xl p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-500 hover:text-stone-300 p-1"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-sky-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar size={32} className="text-sky-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">You&apos;re both going!</h2>
          <p className="text-stone-400 text-sm leading-relaxed">
            You and <span className="text-white font-medium">{name}</span> both liked each other
            and marked <span className="text-sky-400">{eventName}</span> on your calendars.
          </p>
        </div>

        <p className="text-stone-500 text-xs text-center mb-6 flex items-center justify-center gap-1.5">
          <Heart size={12} className="text-emerald-400" fill="currentColor" />
          Check in when you arrive and turn on Open to Meeting to unlock chat.
        </p>

        {overlaps.length > 1 && (
          <p className="text-stone-500 text-xs text-center mb-4">
            +{overlaps.length - 1} more shared event{overlaps.length > 2 ? 's' : ''}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium hover:bg-stone-800 transition"
          >
            Got it
          </button>
          <button
            onClick={onViewEvents}
            className="flex-1 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition"
          >
            View events
          </button>
        </div>
      </div>
    </div>
  );
}
