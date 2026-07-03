import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, MapPin, Radio } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../lib/api';
import { CATEGORY_LABELS, type EventPlanOverlap, type Match, type WildEvent } from '../lib/types';

type Props = {
  onNewMatches: (matches: Match[]) => void;
  onNewOverlaps: (overlaps: EventPlanOverlap[]) => void;
};

export default function EventsPage({ onNewMatches, onNewOverlaps }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [events, setEvents] = useState<WildEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { events: e } = await api.fetchEvents();
      setEvents(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCheckIn(event: WildEvent, devQuick = false) {
    setBusy(event.id);
    setMsg('');
    if (devQuick && event.category === 'dev_lounge') {
      try {
        const res = await api.checkIn(event.id, event.latitude, event.longitude);
        if (res.new_matches?.length) onNewMatches(res.new_matches);
        await refreshProfile();
        setMsg(`Checked in to ${event.name} (dev mode)`);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Check-in failed');
      } finally {
        setBusy('');
      }
      return;
    }
    if (!navigator.geolocation) {
      setMsg('Location is required to check in.');
      setBusy('');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const res = await api.checkIn(event.id, pos.coords.latitude, pos.coords.longitude);
          if (res.new_matches?.length) onNewMatches(res.new_matches);
          await refreshProfile();
          setMsg(`Checked in to ${event.name}`);
        } catch (err) {
          setMsg(err instanceof Error ? err.message : 'Check-in failed');
        } finally {
          setBusy('');
        }
      },
      () => {
        setMsg('Could not get your location. Enable GPS and try again.');
        setBusy('');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function toggleEventPlan(event: WildEvent) {
    if (!event.can_plan) return;
    setBusy(`plan-${event.id}`);
    setMsg('');
    try {
      if (event.is_going) {
        await api.removeEventPlan(event.id);
        setEvents(prev =>
          prev.map(e => (e.id === event.id ? { ...e, is_going: false } : e)),
        );
        setMsg(`Removed ${event.name} from your plans.`);
      } else {
        const res = await api.addEventPlan(event.id);
        setEvents(prev =>
          prev.map(e => (e.id === event.id ? { ...res.event, is_going: true } : e)),
        );
        if (res.new_overlaps?.length) {
          onNewOverlaps(res.new_overlaps);
        } else {
          setMsg(`You're going to ${event.name}! We'll notify you if a match is too.`);
        }
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not update your plans');
    } finally {
      setBusy('');
    }
  }

  async function toggleOpenToMeet() {
    if (!profile?.active_check_in) return;
    setBusy('toggle');
    setMsg('');
    try {
      const next = !profile.active_check_in.open_to_meet;
      const res = await api.setOpenToMeet(next);
      await refreshProfile();
      if (res.new_matches.length > 0) {
        onNewMatches(res.new_matches);
      } else {
        setMsg(next ? "Open to meeting — we'll notify you if a mutual like is here too." : 'Opt-in turned off.');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy('');
    }
  }

  const checkIn = profile?.active_check_in;
  const planned = events.filter(e => e.is_going);
  const upcoming = events.filter(e => !e.is_going);

  function renderEventCard(event: WildEvent) {
    return (
      <article
        key={event.id}
        className={`bg-stone-900 border rounded-2xl p-5 ${
          event.is_going ? 'border-sky-800/60' : 'border-stone-800'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center flex-shrink-0">
            <MapPin size={18} className={event.is_going ? 'text-sky-400' : 'text-emerald-400'} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-semibold">{event.name}</h2>
            <p className="text-stone-400 text-sm">{event.venue_name} · {event.city}</p>
            {event.category && (
              <span className="inline-block mt-2 text-xs bg-stone-800 text-stone-400 px-2 py-0.5 rounded-full">
                {CATEGORY_LABELS[event.category] || event.category}
              </span>
            )}
            {event.description && (
              <p className="text-stone-500 text-sm mt-2">{event.description}</p>
            )}
          </div>
        </div>

        {event.can_plan && (
          <button
            onClick={() => toggleEventPlan(event)}
            disabled={busy === `plan-${event.id}`}
            className={`mt-4 w-full flex items-center justify-center gap-2 text-sm font-medium rounded-xl py-2.5 transition disabled:opacity-50 ${
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

        {checkIn?.event_id === event.id ? (
          <p className="mt-3 text-emerald-400 text-sm flex items-center gap-2">
            <Radio size={14} /> You&apos;re here
          </p>
        ) : event.category === 'dev_lounge' ? (
          <button
            onClick={() => handleCheckIn(event, true)}
            disabled={busy === event.id}
            className="mt-3 w-full bg-emerald-900/50 hover:bg-emerald-800/50 disabled:opacity-50 text-emerald-300 text-sm font-medium rounded-xl py-2.5 transition border border-emerald-800/50"
          >
            {busy === event.id ? 'Checking in…' : 'Dev check-in (no GPS)'}
          </button>
        ) : (
          <button
            onClick={() => handleCheckIn(event)}
            disabled={busy === event.id}
            className="mt-3 w-full bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl py-2.5 transition"
          >
            {busy === event.id ? 'Getting location…' : 'Check in (GPS)'}
          </button>
        )}
      </article>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Events</h1>
      <p className="text-stone-500 text-sm mb-6">
        Mark events you&apos;re attending, then check in when you arrive. Opt in only when you want to meet.
      </p>

      {checkIn && (
        <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-2xl p-5 mb-6">
          <p className="text-emerald-300 text-sm font-medium mb-1">Checked in</p>
          <p className="text-white font-semibold mb-4">{checkIn.event_name}</p>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-stone-300 text-sm font-medium">Open to Meeting Matches</p>
              <p className="text-stone-500 text-xs">Off by default — on a date? Leave it off.</p>
            </div>
            <button
              onClick={toggleOpenToMeet}
              disabled={busy === 'toggle'}
              className={`relative w-14 h-8 rounded-full transition ${
                checkIn.open_to_meet ? 'bg-emerald-500' : 'bg-stone-700'
              }`}
            >
              <span
                className={`absolute top-1 w-6 h-6 bg-white rounded-full transition ${
                  checkIn.open_to_meet ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className="mb-4 text-sm text-stone-400 bg-stone-900 border border-stone-800 rounded-xl px-4 py-3">
          {msg}
        </p>
      )}

      {loading ? (
        <p className="text-stone-500 text-center py-12">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="text-stone-500 text-center py-12">No events scheduled yet.</p>
      ) : (
        <div className="space-y-8">
          {planned.length > 0 && (
            <section>
              <h2 className="text-stone-400 text-xs font-semibold uppercase tracking-wide mb-3">
                You&apos;re going
              </h2>
              <div className="space-y-4">
                {planned.map(event => renderEventCard(event))}
              </div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              {planned.length > 0 && (
                <h2 className="text-stone-400 text-xs font-semibold uppercase tracking-wide mb-3">
                  Upcoming
                </h2>
              )}
              <div className="space-y-4">
                {upcoming.map(event => renderEventCard(event))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
