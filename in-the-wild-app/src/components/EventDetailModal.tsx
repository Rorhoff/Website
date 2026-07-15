import { CalendarCheck, Clock, MapPin, Radio, X } from 'lucide-react';
import { CATEGORY_LABELS, type WildEvent } from '../lib/types';
import { formatEventRange } from '../lib/eventFormat';

type Props = {
  event: WildEvent;
  activeCheckInEventId?: string;
  busy: string;
  onClose: () => void;
  onTogglePlan: (event: WildEvent) => void;
  onCheckIn: (event: WildEvent, devQuick?: boolean) => void;
};

export default function EventDetailModal({
  event,
  activeCheckInEventId,
  busy,
  onClose,
  onTogglePlan,
  onCheckIn,
}: Props) {
  const isCheckedIn = activeCheckInEventId === event.id;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-stone-900 border border-stone-700 rounded-3xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-500 hover:text-stone-300 p-1"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="pr-8 mb-5">
          <h2 className="text-2xl font-bold text-white mb-2">{event.name}</h2>
          {event.category && (
            <span className="inline-block text-xs bg-stone-800 text-stone-400 px-2 py-0.5 rounded-full">
              {CATEGORY_LABELS[event.category] || event.category}
            </span>
          )}
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex items-start gap-3">
            <MapPin size={18} className="text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-white text-sm font-medium">{event.venue_name || 'Venue TBA'}</p>
              <p className="text-stone-400 text-sm">
                {event.city}
                {event.distance_miles != null && ` · ${event.distance_miles} mi away`}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Clock size={18} className="text-sky-400 mt-0.5 shrink-0" />
            <p className="text-stone-300 text-sm">{formatEventRange(event.starts_at, event.ends_at)}</p>
          </div>

          {event.description ? (
            <div className="bg-stone-950/60 border border-stone-800 rounded-2xl px-4 py-3">
              <p className="text-stone-500 text-xs uppercase tracking-wide mb-2">About</p>
              <p className="text-stone-300 text-sm leading-relaxed whitespace-pre-wrap">{event.description}</p>
            </div>
          ) : (
            <p className="text-stone-600 text-sm">No description provided.</p>
          )}

          {event.user_submitted && (
            <p className="text-stone-600 text-xs">Submitted by someone in the community.</p>
          )}
        </div>

        <div className="space-y-3">
          {event.can_plan && (
            <button
              type="button"
              onClick={() => onTogglePlan(event)}
              disabled={busy === `plan-${event.id}`}
              className={`w-full flex items-center justify-center gap-2 text-sm font-medium rounded-xl py-3 transition disabled:opacity-50 ${
                event.is_going
                  ? 'bg-sky-900/40 hover:bg-sky-900/60 text-sky-300 border border-sky-800/50'
                  : 'bg-stone-800 hover:bg-stone-700 text-white'
              }`}
            >
              <CalendarCheck size={16} />
              {busy === `plan-${event.id}`
                ? 'Saving…'
                : event.is_going
                  ? "I'm going — tap to remove"
                  : "I'm going"}
            </button>
          )}

          {isCheckedIn ? (
            <p className="text-emerald-400 text-sm flex items-center justify-center gap-2 py-2">
              <Radio size={14} /> You&apos;re checked in here
            </p>
          ) : event.category === 'dev_lounge' ? (
            <button
              type="button"
              onClick={() => onCheckIn(event, true)}
              disabled={busy === event.id}
              className="w-full bg-emerald-900/50 hover:bg-emerald-800/50 disabled:opacity-50 text-emerald-300 text-sm font-medium rounded-xl py-3 transition border border-emerald-800/50"
            >
              {busy === event.id ? 'Checking in…' : 'Dev check-in (no GPS)'}
            </button>
          ) : event.category !== 'spot' ? (
            <button
              type="button"
              onClick={() => onCheckIn(event)}
              disabled={busy === event.id}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl py-3 transition"
            >
              {busy === event.id ? 'Getting location…' : 'Check in when you arrive (GPS)'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
