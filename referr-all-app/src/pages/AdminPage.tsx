import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Ban, Briefcase, Flag, Loader, Search, Shield, Trash2, User, UserCheck, Users,
} from 'lucide-react';
import * as api from '../lib/api';
import type { AdminJobPost, AdminReport, AdminSeekerPost, AdminStats, AdminUser } from '../lib/api';

type Props = {
  onBack: () => void;
  onViewProfile: (userId: string) => void;
};

type AdminTab = 'overview' | 'users' | 'jobs' | 'seekers' | 'moderation';
type UserFilter = 'all' | 'admin' | 'suspended';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function StatCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-gray-900 border rounded-xl p-4 transition hover:border-blue-500/40 ${
        active ? 'border-blue-500/60 ring-1 ring-blue-500/30' : 'border-gray-800'
      }`}
    >
      <div className="text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-white text-2xl font-bold mt-1">{value.toLocaleString()}</div>
    </button>
  );
}

export default function AdminPage({ onBack, onViewProfile }: Props) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [userFilter, setUserFilter] = useState<UserFilter>('all');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [jobPosts, setJobPosts] = useState<AdminJobPost[]>([]);
  const [seekerPosts, setSeekerPosts] = useState<AdminSeekerPost[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
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
    }
  }, []);

  const loadUsers = useCallback(async (q: string, filter: UserFilter) => {
    setListLoading(true);
    setError('');
    try {
      const rows = await api.searchAdminUsers(q, {
        filter: filter === 'all' ? undefined : filter,
      });
      setUsers(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadJobPosts = useCallback(async () => {
    setListLoading(true);
    try {
      setJobPosts(await api.listAdminJobPosts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job posts');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadSeekerPosts = useCallback(async () => {
    setListLoading(true);
    try {
      setSeekerPosts(await api.listAdminSeekerPosts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seeker posts');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadOverview();
      await loadUsers('', 'all');
      setLoading(false);
    })();
  }, [loadOverview, loadUsers]);

  useEffect(() => {
    if (tab === 'users') loadUsers(search, userFilter);
    else if (tab === 'jobs') loadJobPosts();
    else if (tab === 'seekers') loadSeekerPosts();
  }, [tab, userFilter, loadUsers, loadJobPosts, loadSeekerPosts]);

  function openTab(next: AdminTab, filter: UserFilter = 'all') {
    setTab(next);
    if (next === 'users') setUserFilter(filter);
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    await loadUsers(search, userFilter);
  }

  async function refreshAll() {
    await loadOverview();
    if (tab === 'users') await loadUsers(search, userFilter);
    else if (tab === 'jobs') await loadJobPosts();
    else if (tab === 'seekers') await loadSeekerPosts();
  }

  async function toggleSuspend(u: AdminUser) {
    const verb = u.is_suspended ? 'unsuspend' : 'suspend';
    if (!confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} @${u.username}?`)) return;
    setActionId(u.id);
    try {
      const updated = await api.patchAdminUser(u.id, { isSuspended: !u.is_suspended });
      setUsers(list => list.map(row => (row.id === u.id ? updated : row)));
      await refreshAll();
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
      await refreshAll();
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
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionId(null);
    }
  }

  async function deleteJobPost(post: AdminJobPost) {
    if (!confirm(`Delete job post "${post.company} — ${post.role_title}"?`)) return;
    setActionId(post.id);
    try {
      await api.deleteAdminPost(post.id);
      setJobPosts(list => list.filter(p => p.id !== post.id));
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionId(null);
    }
  }

  async function deleteSeekerPost(post: AdminSeekerPost) {
    if (!confirm(`Delete seeker post "${post.desired_role || post.headline}"?`)) return;
    setActionId(post.id);
    try {
      await api.deleteAdminSeekerPost(post.id);
      setSeekerPosts(list => list.filter(p => p.id !== post.id));
      await refreshAll();
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
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionId(null);
    }
  }

  function renderUserRow(u: AdminUser) {
    return (
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
              {u.job_post_count} job · {u.seeker_post_count} seeker · joined {formatDate(u.created_at)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button type="button" onClick={() => onViewProfile(u.id)} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-gray-800 transition">
            <User size={13} /> Profile
          </button>
          <button type="button" onClick={() => toggleSuspend(u)} disabled={actionId === u.id} className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-amber-500/10 transition disabled:opacity-50">
            <Ban size={13} /> {u.is_suspended ? 'Unsuspend' : 'Suspend'}
          </button>
          <button type="button" onClick={() => toggleAdmin(u)} disabled={actionId === u.id} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-blue-500/10 transition disabled:opacity-50">
            <UserCheck size={13} /> {u.is_admin ? 'Revoke admin' : 'Make admin'}
          </button>
          <button type="button" onClick={() => deleteUser(u)} disabled={actionId === u.id} className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 transition disabled:opacity-50">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 md:pb-0">
      <div className="flex items-center gap-3 mb-6">
        <button type="button" onClick={onBack} className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition flex-shrink-0" title="Back">
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
        <div className="mb-4 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">{error}</div>
      )}

      <section className="mb-6">
        <h2 className="text-white font-semibold text-sm mb-3">Overview</h2>
        {loading && !stats ? (
          <div className="flex justify-center py-8"><Loader size={24} className="animate-spin text-gray-500" /></div>
        ) : stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Users" value={stats.userCount} active={tab === 'users' && userFilter === 'all'} onClick={() => openTab('users', 'all')} />
            <StatCard label="Job posts" value={stats.jobPostCount} active={tab === 'jobs'} onClick={() => openTab('jobs')} />
            <StatCard label="Seeker posts" value={stats.seekerPostCount} active={tab === 'seekers'} onClick={() => openTab('seekers')} />
            <StatCard label="Suspended" value={stats.suspendedCount} active={tab === 'users' && userFilter === 'suspended'} onClick={() => openTab('users', 'suspended')} />
            <StatCard label="Admins" value={stats.adminCount} active={tab === 'users' && userFilter === 'admin'} onClick={() => openTab('users', 'admin')} />
            <StatCard label="Flagged posts" value={stats.flaggedPostCount ?? stats.reportCount} active={tab === 'moderation'} onClick={() => openTab('moderation')} />
          </div>
        ) : null}
      </section>

      {tab === 'overview' && stats && (
        <section className="mb-8 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-white font-medium text-sm mb-2">What are &ldquo;Reports&rdquo;?</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              <strong className="text-gray-300">Flagged posts</strong> are listings users reported as spam or inappropriate.
              When enough distinct users report the same post, it is auto-removed. The moderation queue below lets you review and delete flagged content early.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-wide">New users (7d / 30d)</div>
              <div className="text-white text-lg font-semibold mt-1">{stats.newUsers7d} / {stats.newUsers30d}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-wide">New posts (7d)</div>
              <div className="text-white text-lg font-semibold mt-1">{stats.newJobPosts7d} job · {stats.newSeekerPosts7d} seeker</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-wide">Messages / conversations</div>
              <div className="text-white text-lg font-semibold mt-1">{stats.messageCount} / {stats.conversationCount}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-wide">Connections</div>
              <div className="text-white text-lg font-semibold mt-1">{stats.connectionCount}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-wide">Premium purchases</div>
              <div className="text-white text-lg font-semibold mt-1">{stats.premiumPurchaseCount}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-wide">Premium revenue</div>
              <div className="text-white text-lg font-semibold mt-1">{formatMoney(stats.premiumRevenueCents)}</div>
            </div>
          </div>
          {stats.recentSignups.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-white font-medium text-sm mb-3">Recent signups</h3>
              <div className="space-y-2">
                {stats.recentSignups.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <button type="button" onClick={() => onViewProfile(s.id)} className="text-blue-400 hover:text-blue-300 truncate">
                      @{s.username} · {s.fullName || s.email}
                    </button>
                    <span className="text-gray-600 text-xs flex-shrink-0">{formatDate(s.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'users' && (
        <section className="mb-8">
          <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Users size={16} className="text-gray-400" />
            Users
            {userFilter !== 'all' && (
              <span className="text-gray-500 font-normal">({userFilter})</span>
            )}
          </h2>
          <form onSubmit={runSearch} className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by username, email, or name…" className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <button type="submit" disabled={listLoading} className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium rounded-xl px-4 py-2.5 text-sm transition">
              {listLoading ? '…' : 'Search'}
            </button>
          </form>
          {listLoading && users.length === 0 ? (
            <div className="flex justify-center py-8"><Loader size={24} className="animate-spin text-gray-500" /></div>
          ) : users.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">No users match this filter.</p>
          ) : (
            <div className="space-y-3">{users.map(renderUserRow)}</div>
          )}
        </section>
      )}

      {tab === 'jobs' && (
        <section className="mb-8">
          <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Briefcase size={16} className="text-gray-400" /> Job posts
          </h2>
          {listLoading && jobPosts.length === 0 ? (
            <div className="flex justify-center py-8"><Loader size={24} className="animate-spin text-gray-500" /></div>
          ) : jobPosts.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6 bg-gray-900 border border-gray-800 rounded-xl">No job posts yet.</p>
          ) : (
            <div className="space-y-3">
              {jobPosts.map(post => (
                <div key={post.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-medium truncate">{post.company} — {post.role_title}</div>
                    <div className="text-gray-500 text-xs mt-1">{post.location || 'No location'} · {formatDate(post.created_at)}</div>
                    {post.authorUsername && (
                      <button type="button" onClick={() => onViewProfile(post.author_id)} className="text-blue-400 hover:text-blue-300 text-xs mt-2">
                        @{post.authorUsername}{post.authorName ? ` · ${post.authorName}` : ''}
                      </button>
                    )}
                    {post.reportCount > 0 && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                        {post.reportCount} reports
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => deleteJobPost(post)} disabled={actionId === post.id} className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 border border-red-500/20 transition disabled:opacity-50">
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'seekers' && (
        <section className="mb-8">
          <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Users size={16} className="text-gray-400" /> Seeker posts
          </h2>
          {listLoading && seekerPosts.length === 0 ? (
            <div className="flex justify-center py-8"><Loader size={24} className="animate-spin text-gray-500" /></div>
          ) : seekerPosts.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6 bg-gray-900 border border-gray-800 rounded-xl">No seeker posts yet.</p>
          ) : (
            <div className="space-y-3">
              {seekerPosts.map(post => (
                <div key={post.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-medium truncate">{post.desired_role || post.headline || 'Seeker post'}</div>
                    <div className="text-gray-500 text-xs mt-1">{post.desired_location || 'No location'} · {formatDate(post.created_at)}</div>
                    {post.is_premium && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 mr-2">Premium</span>
                    )}
                    {post.authorUsername && (
                      <button type="button" onClick={() => onViewProfile(post.author_id)} className="text-blue-400 hover:text-blue-300 text-xs mt-2">
                        @{post.authorUsername}{post.authorName ? ` · ${post.authorName}` : ''}
                      </button>
                    )}
                    {post.reportCount > 0 && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                        {post.reportCount} reports
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => deleteSeekerPost(post)} disabled={actionId === post.id} className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 border border-red-500/20 transition disabled:opacity-50">
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'moderation' && (
        <section>
          <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Flag size={16} className="text-gray-400" /> Moderation queue
          </h2>
          <p className="text-gray-500 text-sm mb-4">
            Posts flagged by users, sorted by report count. Posts with {10}+ reports are auto-removed.
          </p>
          {loading && reports.length === 0 ? (
            <div className="flex justify-center py-6"><Loader size={20} className="animate-spin text-gray-500" /></div>
          ) : reports.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6 bg-gray-900 border border-gray-800 rounded-xl">No flagged posts.</p>
          ) : (
            <div className="space-y-3">
              {reports.map(r => {
                const key = `${r.postKind}:${r.postId}`;
                return (
                  <div key={key} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs uppercase tracking-wide text-gray-500">{r.postKind}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">{r.reportCount} reports</span>
                      </div>
                      <div className="text-white font-medium mt-1 truncate">{r.title}</div>
                      {r.preview && <p className="text-gray-500 text-xs mt-1 line-clamp-2">{r.preview}</p>}
                      {r.authorUsername && (
                        <button type="button" onClick={() => onViewProfile(r.authorId)} className="text-blue-400 hover:text-blue-300 text-xs mt-2">
                          @{r.authorUsername}{r.authorName ? ` · ${r.authorName}` : ''}
                        </button>
                      )}
                    </div>
                    <button type="button" onClick={() => deleteReportedPost(r)} disabled={actionId === key} className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 border border-red-500/20 transition disabled:opacity-50 sm:flex-shrink-0">
                      <Trash2 size={13} /> Delete post
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab !== 'overview' && (
        <button type="button" onClick={() => setTab('overview')} className="text-gray-500 hover:text-gray-300 text-xs mt-4">
          ← Back to overview & insights
        </button>
      )}
    </div>
  );
}
