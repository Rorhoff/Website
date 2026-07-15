import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Calendar, Flag, Loader, MessageSquare, Shield, Trash2, Users } from 'lucide-react';
import * as api from '../lib/api';
import type { AdminMessage, AdminReport, AdminStats, Profile, WildEvent } from '../lib/types';
import { CATEGORY_LABELS } from '../lib/types';
import { genderLabel, lookingForLabel } from '../lib/preferences';

type Props = {
  onBack: () => void;
};

type Tab = 'overview' | 'events' | 'users' | 'messages' | 'reports';

const emptyEventForm = () => {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    name: '',
    description: '',
    venue_name: '',
    city: '',
    latitude: 45.5152,
    longitude: -122.6784,
    radius_m: 300,
    category: 'festival',
    starts_at: now.toISOString().slice(0, 16),
    ends_at: end.toISOString().slice(0, 16),
    is_active: true,
  };
};

export default function AdminPage({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [events, setEvents] = useState<WildEvent[]>([]);
  const [users, setUsers] = useState<Array<Profile & { email?: string; created_at?: string; gender?: string; looking_for?: string }>>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [messageUserFilter, setMessageUserFilter] = useState('');
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyEventForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    const [s, r] = await Promise.all([api.fetchAdminStats(), api.fetchAdminReports()]);
    setStats(s);
    setReports(r.reports);
  }, []);

  const loadEvents = useCallback(async () => {
    const { events: e } = await api.fetchAdminEvents();
    setEvents(e);
  }, []);

  const loadUsers = useCallback(async () => {
    const { users: u } = await api.fetchAdminUsers(search, 500);
    setUsers(u);
  }, [search]);

  const loadMessages = useCallback(async () => {
    const { messages: m } = await api.fetchAdminMessages({
      userId: messageUserFilter || undefined,
      limit: 200,
    });
    setMessages(m);
  }, [messageUserFilter]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        await loadOverview();
        await loadEvents();
        await loadUsers();
        await loadMessages();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load admin data');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadOverview, loadEvents, loadUsers, loadMessages]);

  useEffect(() => {
    if (!loading) loadMessages();
  }, [messageUserFilter, loading, loadMessages]);

  function startEdit(ev: WildEvent) {
    setEditingId(ev.id);
    setForm({
      name: ev.name,
      description: ev.description,
      venue_name: ev.venue_name,
      city: ev.city,
      latitude: ev.latitude,
      longitude: ev.longitude,
      radius_m: ev.radius_m,
      category: ev.category,
      starts_at: ev.starts_at?.slice(0, 16) || '',
      ends_at: ev.ends_at?.slice(0, 16) || '',
      is_active: true,
    });
    setTab('events');
  }

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    setBusy('event');
    setError('');
    try {
      const payload = {
        ...form,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
      };
      if (editingId) {
        await api.updateAdminEvent(editingId, payload);
      } else {
        await api.createAdminEvent(payload);
      }
      setForm(emptyEventForm());
      setEditingId(null);
      await loadEvents();
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy('');
    }
  }

  async function removeEvent(id: string) {
    if (!confirm('Delete this event?')) return;
    setBusy(id);
    try {
      await api.deleteAdminEvent(id);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy('');
    }
  }

  async function toggleVerify(u: Profile) {
    setBusy(u.id);
    try {
      await api.patchAdminUser(u.id, { id_verified: !u.id_verified });
      await loadUsers();
    } finally {
      setBusy('');
    }
  }

  async function handleReportAction(reportId: string, action: 'dismiss' | 'suspend_reported') {
    const label = action === 'dismiss' ? 'Dismiss this report?' : 'Suspend the reported user?';
    if (!confirm(label)) return;
    setBusy(reportId);
    setError('');
    try {
      await api.patchAdminReport(reportId, action);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy('');
    }
  }

  const pendingReports = reports.filter(r => (r.status || 'pending') === 'pending');

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'overview', label: 'Overview', icon: Shield },
    { id: 'events', label: 'Events', icon: Calendar },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'reports', label: 'Reports', icon: Flag },
  ];

  return (
    <div>
      <button type="button" onClick={onBack} className="flex items-center gap-2 text-stone-400 hover:text-white text-sm mb-4">
        <ArrowLeft size={16} /> Back
      </button>
      <h1 className="text-xl font-bold text-white mb-4">Administration</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
              tab === id ? 'bg-emerald-600 text-white' : 'bg-stone-900 text-stone-400'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-stone-500"><Loader className="animate-spin" size={24} /></div>
      ) : tab === 'overview' && stats ? (
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Users', stats.users],
            ['Events', stats.events],
            ['Active matches', stats.activeMatches],
            ['Reports', stats.reports],
            ['Waitlist', stats.waitlist],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-stone-900 border border-stone-800 rounded-xl p-4">
              <p className="text-stone-500 text-xs uppercase tracking-wide">{label}</p>
              <p className="text-white text-2xl font-bold mt-1">{value as number}</p>
            </div>
          ))}
        </div>
      ) : tab === 'events' ? (
        <div className="space-y-6">
          <form onSubmit={saveEvent} className="bg-stone-900 border border-stone-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-white font-semibold">{editingId ? 'Edit event' : 'New event'}</h2>
            <input className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <textarea className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <input className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="Venue" value={form.venue_name} onChange={e => setForm(f => ({ ...f, venue_name: e.target.value }))} />
              <input className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="City" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="any" className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="Lat" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: parseFloat(e.target.value) }))} />
              <input type="number" step="any" className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="Lng" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: parseFloat(e.target.value) }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" placeholder="Radius (m)" value={form.radius_m} onChange={e => setForm(f => ({ ...f, radius_m: parseInt(e.target.value, 10) }))} />
              <select className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
                <option value="dev_lounge">Dev test (check-in anywhere on dev)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="datetime-local" className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
              <input type="datetime-local" className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-white text-sm" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} />
            </div>
            <button type="submit" disabled={busy === 'event'} className="w-full bg-emerald-600 text-white font-medium rounded-xl py-2.5 text-sm disabled:opacity-50">
              {busy === 'event' ? 'Saving…' : editingId ? 'Update event' : 'Create event'}
            </button>
          </form>
          <div className="space-y-2">
            {events.map(ev => (
              <div key={ev.id} className="flex items-center gap-3 bg-stone-900 border border-stone-800 rounded-xl p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{ev.name}</p>
                  <p className="text-stone-500 text-xs">{ev.city} · {CATEGORY_LABELS[ev.category] || ev.category}</p>
                </div>
                <button type="button" onClick={() => startEdit(ev)} className="text-emerald-400 text-xs font-medium">Edit</button>
                <button type="button" disabled={busy === ev.id} onClick={() => removeEvent(ev.id)} className="text-red-400 p-1"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'users' ? (
        <div>
          <input
            className="w-full mb-4 bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-white text-sm"
            placeholder="Search users…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadUsers()}
          />
          <button
            type="button"
            onClick={loadUsers}
            className="mb-4 text-emerald-400 text-xs font-medium hover:text-emerald-300"
          >
            Refresh users
          </button>
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 bg-stone-900 border border-stone-800 rounded-xl p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">@{u.username} · {u.display_name}</p>
                  <p className="text-stone-500 text-xs truncate">
                    {u.email || 'no email'}
                    {u.created_at ? ` · joined ${new Date(u.created_at).toLocaleDateString()}` : ''}
                  </p>
                  <p className="text-stone-600 text-xs mt-0.5">
                    {u.gender ? genderLabel(u.gender) : 'gender not set'}
                    {' · '}
                    {u.looking_for ? `into ${lookingForLabel(u.looking_for).toLowerCase()}` : 'prefs not set'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMessageUserFilter(u.id);
                    setTab('messages');
                  }}
                  className="text-xs font-medium px-2 py-1 rounded-lg bg-stone-800 text-stone-300 hover:text-white"
                >
                  Messages
                </button>
                <button
                  type="button"
                  disabled={busy === u.id}
                  onClick={() => toggleVerify(u)}
                  className={`text-xs font-medium px-2 py-1 rounded-lg ${u.id_verified ? 'bg-emerald-950 text-emerald-400' : 'bg-stone-800 text-stone-400'}`}
                >
                  {u.id_verified ? 'Verified' : 'Verify ID'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'messages' ? (
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={messageUserFilter}
              onChange={e => setMessageUserFilter(e.target.value)}
              className="flex-1 min-w-[12rem] bg-stone-900 border border-stone-700 rounded-xl px-3 py-2.5 text-white text-sm"
            >
              <option value="">All messages</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  @{u.username} ({u.email || 'no email'})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadMessages}
              className="px-4 py-2.5 rounded-xl bg-stone-800 text-stone-300 text-sm font-medium hover:bg-stone-700"
            >
              Refresh
            </button>
          </div>
          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-stone-500 text-sm text-center py-8">No messages found.</p>
            ) : messages.map(m => (
              <div key={m.id} className="bg-stone-900 border border-stone-800 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-white text-sm font-medium">
                      @{m.sender_username} → @{m.user_a?.username}
                      {m.user_b ? ` ↔ @${m.user_b.username}` : ''}
                    </p>
                    <p className="text-stone-600 text-xs mt-0.5">
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <p className="text-stone-300 text-sm whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingReports.length === 0 ? (
            <p className="text-stone-500 text-sm text-center py-8">No pending reports.</p>
          ) : pendingReports.map(r => (
            <div key={r.id} className="bg-stone-900 border border-stone-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white text-sm">
                    @{r.reporter?.username} reported @{r.reported?.username}
                  </p>
                  {r.reason && <p className="text-stone-400 text-xs mt-1">{r.reason}</p>}
                  <p className="text-stone-600 text-xs mt-1">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="text-xs bg-amber-950 text-amber-400 px-2 py-0.5 rounded-full capitalize">
                  {r.status}
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => handleReportAction(r.id, 'dismiss')}
                  className="flex-1 text-xs font-medium py-2 rounded-lg bg-stone-800 text-stone-300 hover:bg-stone-700 disabled:opacity-50"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => handleReportAction(r.id, 'suspend_reported')}
                  className="flex-1 text-xs font-medium py-2 rounded-lg bg-red-950 text-red-400 hover:bg-red-900 disabled:opacity-50"
                >
                  Suspend user
                </button>
              </div>
            </div>
          ))}
          {reports.some(r => r.status !== 'pending') && (
            <div className="pt-4 border-t border-stone-800">
              <p className="text-stone-500 text-xs uppercase tracking-wide mb-2">Reviewed</p>
              {reports.filter(r => r.status !== 'pending').map(r => (
                <div key={r.id} className="text-stone-500 text-xs py-1">
                  @{r.reported?.username} — {r.status}
                  {r.reviewed_at ? ` · ${new Date(r.reviewed_at).toLocaleDateString()}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
