import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Calendar, Camera, ChevronDown, ChevronUp, MapPin, Shield, Settings, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../lib/api';
import {
  disableNotifications,
  enableNotifications,
  syncNotificationsPreference,
} from '../lib/browserNotifications';
import { subscribeToPushNotifications, unsubscribeFromPushNotifications } from '../lib/pushNotifications';
import { compressImageForUpload } from '../lib/resizeImage';
import { GENDER_OPTIONS, LOOKING_FOR_OPTIONS } from '../lib/preferences';
import { CATEGORY_LABELS, type EventPlanOverlap, type EventsFilterMeta, type WildEvent } from '../lib/types';

function formatEventDate(iso: string | null | undefined): string {
  if (!iso) return 'Date TBA';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

type Props = {
  onOpenAdmin?: () => void;
  onNewOverlaps?: (overlaps: EventPlanOverlap[]) => void;
};

export default function ProfilePage({ onOpenAdmin, onNewOverlaps }: Props) {
  const { profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState(profile?.bio || '');
  const [city, setCity] = useState(profile?.city || '');
  const [gender, setGender] = useState(profile?.gender || '');
  const [lookingFor, setLookingFor] = useState(profile?.looking_for || '');
  const [interests, setInterests] = useState((profile?.interests || []).join(', '));
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [notifyOn, setNotifyOn] = useState(Boolean(profile?.venue_match_alerts));
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState('');
  const [plannedEvents, setPlannedEvents] = useState<WildEvent[]>([]);
  const [addableEvents, setAddableEvents] = useState<WildEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventBusy, setEventBusy] = useState('');
  const [eventMsg, setEventMsg] = useState('');
  const [showAddEvents, setShowAddEvents] = useState(false);
  const [showSubmitEvent, setShowSubmitEvent] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [eventsFilter, setEventsFilter] = useState<EventsFilterMeta | null>(null);
  const [submitForm, setSubmitForm] = useState({
    name: '',
    venue_name: '',
    city: profile?.city || '',
    description: '',
    starts_at: '',
    ends_at: '',
  });

  const loadEventPlans = useCallback(async () => {
    setEventsLoading(true);
    try {
      const [{ plans }, { events, filter }] = await Promise.all([
        api.fetchEventPlans(),
        api.fetchEvents(),
      ]);
      setEventsFilter(filter);
      const planned = plans.map(p => p.event);
      const plannedIds = new Set(planned.map(e => e.id));
      setPlannedEvents(planned);
      setAddableEvents(events.filter(e => e.can_plan && !plannedIds.has(e.id)));
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEventPlans();
  }, [loadEventPlans]);

  useEffect(() => {
    setNotifyOn(Boolean(profile?.venue_match_alerts));
    syncNotificationsPreference(Boolean(profile?.venue_match_alerts));
  }, [profile?.venue_match_alerts]);

  useEffect(() => {
    if (profile?.city) {
      setSubmitForm(f => ({ ...f, city: profile.city }));
    }
  }, [profile?.city]);

  if (!profile) return null;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImageForUpload(file);
      await api.uploadAvatar(compressed);
      await refreshProfile();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleVerify() {
    try {
      const res = await api.startIdVerification();
      setVerifyMsg(res.message);
    } catch (err) {
      setVerifyMsg(err instanceof Error ? err.message : 'Could not start verification');
    }
  }

  async function handleNotifyToggle() {
    if (notifyBusy) return;
    setNotifyMsg('');
    setNotifyBusy(true);
    const next = !notifyOn;
    try {
      await api.updateProfile({ venue_match_alerts: next });
      await refreshProfile();
      setNotifyOn(next);
      if (next) {
        enableNotifications();
        const push = await subscribeToPushNotifications();
        if (push.message) setNotifyMsg(push.message);
      } else {
        disableNotifications();
        await unsubscribeFromPushNotifications();
      }
    } catch (err) {
      setNotifyMsg(err instanceof Error ? err.message : 'Could not update alerts');
      setNotifyOn(Boolean(profile?.venue_match_alerts));
    } finally {
      setNotifyBusy(false);
    }
  }

  async function handleAddEventPlan(event: WildEvent) {
    setEventBusy(event.id);
    setEventMsg('');
    try {
      const res = await api.addEventPlan(event.id);
      await loadEventPlans();
      setShowAddEvents(false);
      if (res.new_overlaps?.length) {
        onNewOverlaps?.(res.new_overlaps);
      } else {
        setEventMsg(`Added ${event.name} — we'll notify you if a match is going too.`);
      }
    } catch (err) {
      setEventMsg(err instanceof Error ? err.message : 'Could not add event');
    } finally {
      setEventBusy('');
    }
  }

  async function handleRemoveEventPlan(event: WildEvent) {
    setEventBusy(event.id);
    setEventMsg('');
    try {
      await api.removeEventPlan(event.id);
      await loadEventPlans();
      setEventMsg(`Removed ${event.name}.`);
    } catch (err) {
      setEventMsg(err instanceof Error ? err.message : 'Could not remove event');
    } finally {
      setEventBusy('');
    }
  }

  async function handleSubmitEvent(e: React.FormEvent) {
    e.preventDefault();
    setSubmitBusy(true);
    setEventMsg('');
    try {
      const res = await api.submitEvent({
        name: submitForm.name,
        venue_name: submitForm.venue_name,
        city: submitForm.city,
        description: submitForm.description,
        starts_at: new Date(submitForm.starts_at).toISOString(),
        ends_at: new Date(submitForm.ends_at).toISOString(),
      });
      await loadEventPlans();
      setShowSubmitEvent(false);
      setSubmitForm(f => ({ ...f, name: '', venue_name: '', description: '', starts_at: '', ends_at: '' }));
      setEventMsg(res.message);
      if (!res.already_exists && res.event.can_plan) {
        const planRes = await api.addEventPlan(res.event.id);
        if (planRes.new_overlaps?.length) onNewOverlaps?.(planRes.new_overlaps);
        else if (!res.already_exists) {
          setEventMsg(`${res.message} Added to your calendar.`);
        }
      }
    } catch (err) {
      setEventMsg(err instanceof Error ? err.message : 'Could not submit event');
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    try {
      await api.updateProfile({
        bio,
        city,
        gender,
        looking_for: lookingFor,
        interests: interests.split(',').map(s => s.trim()).filter(Boolean),
      });
      await refreshProfile();
      setSaved(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Profile</h1>
        {profile.is_admin && onOpenAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium"
          >
            <Settings size={16} /> Admin
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative w-20 h-20 rounded-2xl bg-stone-800 overflow-hidden flex items-center justify-center group"
        >
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl font-bold text-stone-600">
              {(profile.display_name || '?').charAt(0)}
            </span>
          )}
          <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
            <Camera size={20} className="text-white" />
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        <div>
          <p className="text-white font-bold text-lg">{profile.display_name}</p>
          <p className="text-stone-500 text-sm">@{profile.username}{profile.age ? ` · ${profile.age}` : ''}</p>
          <p className="text-stone-600 text-xs mt-1">{uploading ? 'Uploading…' : 'Tap photo to upload'}</p>
          {profile.id_verified && (
            <span className="inline-flex mt-2 text-xs bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full items-center gap-1">
              ID verified
            </span>
          )}
        </div>
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell size={18} className="text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-white text-sm font-medium">Venue match alerts</p>
              <p className="text-stone-500 text-xs mt-1">
                Push notification when a mutual match is within 100 feet at an event.
                On iPhone/Android, add the app to your home screen first.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleNotifyToggle}
            disabled={notifyBusy}
            className={`relative w-14 h-8 rounded-full transition flex-shrink-0 disabled:opacity-50 ${
              notifyOn ? 'bg-emerald-500' : 'bg-stone-700'
            }`}
          >
            <span
              className={`absolute top-1 w-6 h-6 bg-white rounded-full transition ${
                notifyOn ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
        {notifyMsg && <p className="text-stone-400 text-xs mt-2">{notifyMsg}</p>}
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white text-sm font-medium">Identity verification</p>
            <p className="text-stone-500 text-xs mt-1">
              Optional during beta. Stripe Identity coming soon — admins can verify manually.
            </p>
            {!profile.id_verified && (
              <button
                type="button"
                onClick={handleVerify}
                className="mt-3 text-sm text-emerald-400 font-medium hover:text-emerald-300"
              >
                Start verification →
              </button>
            )}
            {verifyMsg && <p className="text-stone-400 text-xs mt-2">{verifyMsg}</p>}
          </div>
        </div>
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6">
        <div className="flex items-start gap-3 mb-4">
          <Calendar size={18} className="text-sky-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white text-sm font-medium">Upcoming events</p>
            <p className="text-stone-500 text-xs mt-1">
              Events within 50 miles of your city that you&apos;re planning to attend.
              {eventsFilter?.needs_city && ' Set your city below to see nearby events.'}
            </p>
          </div>
        </div>

        {eventsLoading ? (
          <p className="text-stone-500 text-sm">Loading events…</p>
        ) : plannedEvents.length === 0 ? (
          <p className="text-stone-500 text-sm mb-3">No events on your calendar yet.</p>
        ) : (
          <ul className="space-y-2 mb-3">
            {plannedEvents.map(event => (
              <li
                key={event.id}
                className="flex items-start gap-3 bg-stone-950/60 border border-sky-900/40 rounded-xl px-3 py-3"
              >
                <MapPin size={16} className="text-sky-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{event.name}</p>
                  <p className="text-stone-500 text-xs">
                    {formatEventDate(event.starts_at)} · {event.venue_name || event.city}
                  </p>
                  {event.category && (
                    <span className="inline-block mt-1 text-xs bg-stone-800 text-stone-400 px-2 py-0.5 rounded-full">
                      {CATEGORY_LABELS[event.category] || event.category}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveEventPlan(event)}
                  disabled={eventBusy === event.id}
                  className="text-stone-500 hover:text-stone-300 p-1 disabled:opacity-50"
                  aria-label={`Remove ${event.name}`}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {addableEvents.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowAddEvents(v => !v)}
              className="flex items-center gap-1.5 text-sm text-sky-400 font-medium hover:text-sky-300"
            >
              {showAddEvents ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              Add an event
            </button>
            {showAddEvents && (
              <ul className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                {addableEvents.map(event => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => handleAddEventPlan(event)}
                      disabled={eventBusy === event.id}
                      className="w-full text-left bg-stone-950 border border-stone-800 hover:border-stone-700 disabled:opacity-50 rounded-xl px-3 py-3 transition"
                    >
                      <p className="text-white text-sm font-medium">{event.name}</p>
                      <p className="text-stone-500 text-xs">
                        {formatEventDate(event.starts_at)} · {event.venue_name || event.city}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!eventsLoading && addableEvents.length === 0 && plannedEvents.length > 0 && (
          <p className="text-stone-600 text-xs">All nearby events are on your calendar.</p>
        )}

        <div className="mt-4 pt-4 border-t border-stone-800">
          <button
            type="button"
            onClick={() => setShowSubmitEvent(v => !v)}
            className="flex items-center gap-1.5 text-sm text-emerald-400 font-medium hover:text-emerald-300"
          >
            {showSubmitEvent ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Submit your own event
          </button>
          {showSubmitEvent && (
            <form onSubmit={handleSubmitEvent} className="mt-3 space-y-3">
              <input
                required
                value={submitForm.name}
                onChange={e => setSubmitForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Event name"
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
              <input
                required
                value={submitForm.venue_name}
                onChange={e => setSubmitForm(f => ({ ...f, venue_name: e.target.value }))}
                placeholder="Venue"
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
              <input
                required
                value={submitForm.city}
                onChange={e => setSubmitForm(f => ({ ...f, city: e.target.value }))}
                placeholder="City"
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
              <textarea
                value={submitForm.description}
                onChange={e => setSubmitForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description (optional)"
                rows={2}
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  type="datetime-local"
                  value={submitForm.starts_at}
                  onChange={e => setSubmitForm(f => ({ ...f, starts_at: e.target.value }))}
                  className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
                />
                <input
                  required
                  type="datetime-local"
                  value={submitForm.ends_at}
                  onChange={e => setSubmitForm(f => ({ ...f, ends_at: e.target.value }))}
                  className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitBusy}
                className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl py-2.5"
              >
                {submitBusy ? 'Submitting…' : 'Add event to list'}
              </button>
              <p className="text-stone-600 text-xs">
                We&apos;ll check if someone already added this event before creating a duplicate.
              </p>
            </form>
          )}
        </div>

        {eventMsg && <p className="text-stone-400 text-xs mt-3">{eventMsg}</p>}
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-stone-400 text-xs block mb-1">I am</label>
          <select
            value={gender}
            onChange={e => setGender(e.target.value)}
            required
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          >
            <option value="">Select…</option>
            {GENDER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">Interested in</label>
          <select
            value={lookingFor}
            onChange={e => setLookingFor(e.target.value)}
            required
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          >
            <option value="">Select…</option>
            {LOOKING_FOR_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">City</label>
          <input
            value={city}
            onChange={e => setCity(e.target.value)}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">Interests (comma-separated)</label>
          <input
            value={interests}
            onChange={e => setInterests(e.target.value)}
            placeholder="hiking, live music, coffee"
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition"
        >
          {loading ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <p className="text-emerald-400 text-sm text-center">Saved!</p>}
      </form>
    </div>
  );
}
