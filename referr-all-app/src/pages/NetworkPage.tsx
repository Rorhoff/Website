import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';
import type { Profile, Connection } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';
import { UserPlus, UserCheck, UserX, Search, Users, Clock, MapPin, Briefcase } from 'lucide-react';

type Tab = 'discover' | 'connections' | 'pending';

type Props = {
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string) => void;
};

export default function NetworkPage({ onViewProfile, onMessage }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('discover');
  const [people, setPeople] = useState<Profile[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pending, setPending] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [allProfiles, allConns] = await Promise.all([
      api.listProfiles(),
      api.listConnections(),
    ]);

    const allConnsTyped = allConns as Connection[];
    setConnections(allConnsTyped.filter(c => c.status === 'accepted'));
    setPending(allConnsTyped.filter(c => c.status === 'pending'));

    const connectedIds = new Set(allConnsTyped.filter(c => c.status === 'accepted').map(c =>
      c.requester_id === user.id ? c.addressee_id : c.requester_id
    ));
    const pendingIds = new Set(allConnsTyped.map(c =>
      c.requester_id === user.id ? c.addressee_id : c.requester_id
    ));

    const profiles = allProfiles as Profile[];
    setPeople(profiles.filter(p => !connectedIds.has(p.id) && !pendingIds.has(p.id)));

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function sendRequest(addresseeId: string) {
    if (!user) return;
    setActionLoading(addresseeId);
    await api.createConnection(addresseeId);
    await loadAll();
    setActionLoading(null);
  }

  async function respondRequest(connId: string, status: 'accepted' | 'declined') {
    setActionLoading(connId);
    await api.updateConnection(connId, status);
    await loadAll();
    setActionLoading(null);
  }

  async function removeConnection(connId: string) {
    setActionLoading(connId);
    await api.deleteConnection(connId);
    await loadAll();
    setActionLoading(null);
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'discover', label: 'Discover' },
    { id: 'connections', label: 'Connections', count: connections.length },
    { id: 'pending', label: 'Pending', count: pending.filter(c => c.addressee_id === user?.id).length },
  ];

  const filteredPeople = people.filter(p => {
    const q = search.toLowerCase();
    return !q || p.full_name.toLowerCase().includes(q) || p.company.toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-3xl mx-auto pb-20 md:pb-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">My Network</h1>
        <p className="text-gray-500 text-sm mt-0.5">Grow your professional connections</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-6 border border-gray-800">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.id ? 'bg-blue-500 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                tab === t.id ? 'bg-white/20' : 'bg-gray-700'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search (discover tab only) */}
      {tab === 'discover' && (
        <div className="relative mb-6">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, company, or role..."
            className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-10 pr-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
          />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-gray-900 rounded-2xl border border-gray-800 p-5 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gray-800" />
                <div className="space-y-2">
                  <div className="w-28 h-4 bg-gray-800 rounded" />
                  <div className="w-20 h-3 bg-gray-800 rounded" />
                </div>
              </div>
              <div className="w-full h-8 bg-gray-800 rounded-lg" />
            </div>
          ))}
        </div>
      ) : tab === 'discover' ? (
        filteredPeople.length === 0 ? (
          <EmptyState icon={Users} title="No people to discover" desc="You're connected with everyone, or no other users exist yet." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredPeople.map(person => (
              <PersonCard
                key={person.id}
                person={person}
                action={
                  <button
                    onClick={() => sendRequest(person.id)}
                    disabled={actionLoading === person.id}
                    className="flex items-center gap-2 w-full justify-center bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-blue-400 font-medium rounded-xl py-2.5 text-sm transition-all disabled:opacity-50"
                  >
                    <UserPlus size={14} />
                    {actionLoading === person.id ? 'Sending...' : 'Connect'}
                  </button>
                }
                onViewProfile={onViewProfile}
              />
            ))}
          </div>
        )
      ) : tab === 'connections' ? (
        connections.length === 0 ? (
          <EmptyState icon={UserCheck} title="No connections yet" desc="Start by discovering people and sending connection requests." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {connections.map(conn => {
              const other = conn.requester_id === user?.id ? conn.addressee as unknown as Profile : conn.requester as unknown as Profile;
              return (
                <PersonCard
                  key={conn.id}
                  person={other}
                  action={
                    <div className="flex gap-2">
                      <button
                        onClick={() => onMessage(other.id)}
                        className="flex-1 flex items-center gap-2 justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl py-2.5 text-sm transition"
                      >
                        Message
                      </button>
                      <button
                        onClick={() => removeConnection(conn.id)}
                        disabled={actionLoading === conn.id}
                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded-xl transition disabled:opacity-50"
                        title="Remove connection"
                      >
                        <UserX size={15} />
                      </button>
                    </div>
                  }
                  onViewProfile={onViewProfile}
                />
              );
            })}
          </div>
        )
      ) : (
        // Pending
        <div className="space-y-4">
          {pending.filter(c => c.addressee_id === user?.id).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Received</h3>
              <div className="space-y-3">
                {pending.filter(c => c.addressee_id === user?.id).map(conn => {
                  const requester = conn.requester as unknown as Profile;
                  return (
                    <div key={conn.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-5 flex items-center justify-between gap-4">
                      <button onClick={() => onViewProfile(requester.id)} className="flex items-center gap-3 group min-w-0">
                        <Avatar profile={requester} size="md" />
                        <div className="min-w-0">
                          <div className="text-white font-semibold text-sm group-hover:text-blue-400 transition truncate">{requester?.full_name}</div>
                          <div className="text-gray-500 text-xs truncate">{requester?.role && requester?.company ? `${requester.role} at ${requester.company}` : `@${requester?.username}`}</div>
                        </div>
                      </button>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => respondRequest(conn.id, 'accepted')}
                          disabled={actionLoading === conn.id}
                          className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-3 py-2 text-sm transition disabled:opacity-50"
                        >
                          <UserCheck size={14} />
                          Accept
                        </button>
                        <button
                          onClick={() => respondRequest(conn.id, 'declined')}
                          disabled={actionLoading === conn.id}
                          className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 font-medium rounded-lg px-3 py-2 text-sm transition disabled:opacity-50"
                        >
                          <UserX size={14} />
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pending.filter(c => c.requester_id === user?.id).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Sent</h3>
              <div className="space-y-3">
                {pending.filter(c => c.requester_id === user?.id).map(conn => {
                  const addressee = conn.addressee as unknown as Profile;
                  return (
                    <div key={conn.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-5 flex items-center justify-between gap-4">
                      <button onClick={() => onViewProfile(addressee.id)} className="flex items-center gap-3 group min-w-0">
                        <Avatar profile={addressee} size="md" />
                        <div className="min-w-0">
                          <div className="text-white font-semibold text-sm group-hover:text-blue-400 transition truncate">{addressee?.full_name}</div>
                          <div className="text-gray-500 text-xs truncate">{addressee?.role && addressee?.company ? `${addressee.role} at ${addressee.company}` : `@${addressee?.username}`}</div>
                        </div>
                      </button>
                      <span className="flex items-center gap-1.5 text-amber-400 text-xs bg-amber-500/10 px-2.5 py-1.5 rounded-lg">
                        <Clock size={11} />
                        Pending
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pending.length === 0 && (
            <EmptyState icon={Clock} title="No pending requests" desc="Send connection requests to grow your network." />
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ profile, size = 'md' }: { profile: Profile; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
  const txt = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base';
  return (
    <div className={`${sz} rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center overflow-hidden flex-shrink-0`}>
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className={`text-blue-400 font-semibold ${txt}`}>
          {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
        </span>
      )}
    </div>
  );
}

function PersonCard({ person, action, onViewProfile }: { person: Profile; action: React.ReactNode; onViewProfile: (id: string) => void }) {
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 hover:border-gray-700 transition-colors p-5">
      <button onClick={() => onViewProfile(person.id)} className="flex items-center gap-3 mb-4 group w-full text-left">
        <Avatar profile={person} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold group-hover:text-blue-400 transition truncate">{person.full_name}</div>
          {person.role && (
            <div className="text-gray-400 text-sm truncate flex items-center gap-1 mt-0.5">
              <Briefcase size={11} className="flex-shrink-0" />
              {person.role}
            </div>
          )}
          {person.company && (
            <div className="text-gray-500 text-xs truncate">at {person.company}</div>
          )}
          {person.location && (
            <div className="text-gray-600 text-xs flex items-center gap-1 mt-0.5 truncate">
              <MapPin size={10} className="flex-shrink-0" />
              {person.location}
            </div>
          )}
        </div>
      </button>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc }: { icon: typeof Users; title: string; desc: string }) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Icon size={28} className="text-gray-600" />
      </div>
      <p className="text-gray-400 font-medium">{title}</p>
      <p className="text-gray-600 text-sm mt-1">{desc}</p>
    </div>
  );
}
