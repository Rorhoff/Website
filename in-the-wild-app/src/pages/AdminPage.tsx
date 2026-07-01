import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Calendar, Flag, Loader, Shield, Trash2, Users } from 'lucide-react';
import * as api from '../lib/api';
import type { AdminReport, AdminStats, Profile, WildEvent } from '../lib/types';
import { CATEGORY_LABELS } from '../lib/types';

type Props = {
  onBack: () => void;
};

type Tab = 'overview' | 'events' | 'users' | 'reports';

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
  const [users, setUsers] = useState<Profile[]>([]);
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
    const { users: u } = await api.fetchAdminUsers(search);
    setUsers(u);
  }, [search]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        await loadOverview();
        await loadEvents();
        await loadUsers();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load admin data');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadOverview, loadEvents, loadUsers]);

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

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'overview', label: 'Overview', icon: Shield },
    { id: 'events', label: 'Events', icon: Calendar },
    { id: 'users', label: 'Users', icon: Users },
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
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 bg-stone-900 border border-stone-800 rounded-xl p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">@{u.username} · {u.display_name}</p>
                  <p className="text-stone-500 text-xs truncate">@{u.username}{'email' in u ? ` · ${(u as Profile & { email?: string }).email}` : ''}</p>
                </div>
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
      ) : (
        <div className="space-y-2">
          {reports.length === 0 ? (
            <p className="text-stone-500 text-sm text-center py-8">No reports yet.</p>
          ) : reports.map(r => (
            <div key={r.id} className="bg-stone-900 border border-stone-800 rounded-xl p-3">
              <p className="text-white text-sm">
                {r.reporter?.username} reported {r.reported?.username}
              </p>
              {r.reason && <p className="text-stone-400 text-xs mt-1">{r.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
