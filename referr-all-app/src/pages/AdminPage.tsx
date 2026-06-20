import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Ban, Flag, Loader, Search, Shield, Trash2, User, UserCheck, Users,
} from 'lucide-react';
import * as api from '../lib/api';
import type { AdminReport, AdminStats, AdminUser } from '../lib/api';

type Props = {
  onBack: () => void;
  onViewProfile: (userId: string) => void;
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-white text-2xl font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

export default function AdminPage({ onBack, onViewProfile }: Props) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, r] = await Promise.all([
        api.fetchAdminStats(),
        api.listAdminReports(),
      ]);
      setStats(s);
      setReports(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setSearching(true);
    setError('');
    try {
      const rows = await api.searchAdminUsers(search);
      setUsers(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function toggleSuspend(u: AdminUser) {
    const verb = u.is_suspended ? 'unsuspend' : 'suspend';
    if (!confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} @${u.username}?`)) return;
    setActionId(u.id);
    try {
      const updated = await api.patchAdminUser(u.id, { isSuspended: !u.is_suspended });
      setUsers(list => list.map(row => (row.id === u.id ? updated : row)));
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionId(null);
    }
  }

  async function toggleAdmin(u: AdminUser) {
    const grant = !u.is_admin;
    if (!confirm(`${grant ? 'Grant' : 'Revoke'} admin for @${u.username}?`)) return;
    setActionId(u.id);
    try {
      const updated = await api.patchAdminUser(u.id, { isAdmin: grant });
      setUsers(list => list.map(row => (row.id === u.id ? updated : row)));
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionId(null);
    }
  }

  async function deleteUser(u: AdminUser) {
    const typed = prompt(`Type the username "${u.username}" to confirm deletion:`);
    if (typed !== u.username) return;
    setActionId(u.id);
    try {
      await api.deleteAdminUser(u.id);
      setUsers(list => list.filter(row => row.id !== u.id));
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionId(null);
    }
  }

  async function deleteReportedPost(report: AdminReport) {
    if (!confirm(`Delete this ${report.postKind} post (${report.reportCount} reports)?`)) return;
    const key = `${report.postKind}:${report.postId}`;
    setActionId(key);
    try {
      if (report.postKind === 'job') {
        await api.deleteAdminPost(report.postId);
      } else {
        await api.deleteAdminSeekerPost(report.postId);
      }
      setReports(list => list.filter(r => !(r.postId === report.postId && r.postKind === report.postKind)));
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 md:pb-0">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition flex-shrink-0"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield size={22} className="text-blue-400" />
            Administration
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage users, posts, and moderation</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h2 className="text-white font-semibold text-sm mb-3">Overview</h2>
        {loading && !stats ? (
          <div className="flex justify-center py-8">
            <Loader size={24} className="animate-spin text-gray-500" />
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Users" value={stats.userCount} />
            <StatCard label="Job posts" value={stats.jobPostCount} />
            <StatCard label="Seeker posts" value={stats.seekerPostCount} />
            <StatCard label="Suspended" value={stats.suspendedCount} />
            <StatCard label="Admins" value={stats.adminCount} />
            <StatCard label="Reports" value={stats.reportCount} />
          </div>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Users size={16} className="text-gray-400" />
          Users
        </h2>
        <form onSubmit={runSearch} className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search username, email, or name…"
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium rounded-xl px-4 py-2.5 text-sm transition"
          >
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {users.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">Search to find users.</p>
        ) : (
          <div className="space-y-3">
            {users.map(u => (
              <div
                key={u.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-white font-medium truncate">
                    {u.full_name || u.username}
                    <span className="text-gray-500 font-normal ml-2">@{u.username}</span>
                  </div>
                  <div className="text-gray-500 text-xs truncate mt-0.5">{u.email}</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {u.is_admin && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                        Admin
                      </span>
                    )}
                    {u.is_suspended && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                        Suspended
                      </span>
                    )}
                    <span className="text-xs text-gray-600">
                      {u.job_post_count} job · {u.seeker_post_count} seeker
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => onViewProfile(u.id)}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-gray-800 transition"
                  >
                    <User size={13} />
                    Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSuspend(u)}
                    disabled={actionId === u.id}
                    className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-amber-500/10 transition disabled:opacity-50"
                  >
                    <Ban size={13} />
                    {u.is_suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAdmin(u)}
                    disabled={actionId === u.id}
                    className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-blue-500/10 transition disabled:opacity-50"
                  >
                    <UserCheck size={13} />
                    {u.is_admin ? 'Revoke admin' : 'Make admin'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteUser(u)}
                    disabled={actionId === u.id}
                    className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 transition disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Flag size={16} className="text-gray-400" />
          Moderation queue
        </h2>
        {loading && reports.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader size={20} className="animate-spin text-gray-500" />
          </div>
        ) : reports.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6 bg-gray-900 border border-gray-800 rounded-xl">
            No reported posts.
          </p>
        ) : (
          <div className="space-y-3">
            {reports.map(r => {
              const key = `${r.postKind}:${r.postId}`;
              return (
                <div
                  key={key}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs uppercase tracking-wide text-gray-500">{r.postKind}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                        {r.reportCount} reports
                      </span>
                    </div>
                    <div className="text-white font-medium mt-1 truncate">{r.title}</div>
                    {r.preview && (
                      <p className="text-gray-500 text-xs mt-1 line-clamp-2">{r.preview}</p>
                    )}
                    {r.authorUsername && (
                      <button
                        type="button"
                        onClick={() => onViewProfile(r.authorId)}
                        className="text-blue-400 hover:text-blue-300 text-xs mt-2"
                      >
                        @{r.authorUsername}
                        {r.authorName ? ` · ${r.authorName}` : ''}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteReportedPost(r)}
                    disabled={actionId === key}
                    className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 border border-red-500/20 transition disabled:opacity-50 sm:flex-shrink-0"
                  >
                    <Trash2 size={13} />
                    Delete post
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
