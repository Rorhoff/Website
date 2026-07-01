import { useCallback, useEffect, useState } from 'react';
import { MapPin, Radio } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../lib/api';
import { CATEGORY_LABELS, type Match, type WildEvent } from '../lib/types';

type Props = {
  onNewMatches: (matches: Match[]) => void;
};

export default function EventsPage({ onNewMatches }: Props) {
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

  async function handleCheckIn(event: WildEvent) {
    setBusy(event.id);
    setMsg('');
    if (!navigator.geolocation) {
      setMsg('Location is required to check in.');
      setBusy('');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          await api.checkIn(event.id, pos.coords.latitude, pos.coords.longitude);
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

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Events</h1>
      <p className="text-stone-500 text-sm mb-6">Check in when you arrive. Opt in only when you want to meet.</p>

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
        <div className="space-y-4">
          {events.map(event => (
            <article key={event.id} className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center flex-shrink-0">
                  <MapPin size={18} className="text-emerald-400" />
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
              {checkIn?.event_id === event.id ? (
                <p className="mt-4 text-emerald-400 text-sm flex items-center gap-2">
                  <Radio size={14} /> You&apos;re here
                </p>
              ) : (
                <button
                  onClick={() => handleCheckIn(event)}
                  disabled={busy === event.id}
                  className="mt-4 w-full bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl py-2.5 transition"
                >
                  {busy === event.id ? 'Getting location…' : 'Check in (GPS)'}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
