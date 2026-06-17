import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Ban, ShieldCheck, UserCheck } from 'lucide-react';
import * as api from '../lib/api';
import type { BlockEntry } from '../lib/api';
import type { Profile } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  onBack: () => void;
  onViewProfile: (userId: string) => void;
};

export default function SettingsPage({ onBack, onViewProfile }: Props) {
  const { user } = useAuth();
  const [blockedList, setBlockedList] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadBlocks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const blocks = await api.listBlocks();
    setBlockedList(blocks);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  async function unblockUser(blockedId: string) {
    setActionLoading(blockedId);
    await api.deleteBlock(blockedId);
    await loadBlocks();
    setActionLoading(null);
  }

  return (
    <div className="max-w-3xl mx-auto pb-20 md:pb-0">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition flex-shrink-0"
          title="Back to profile"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your account, privacy, and security</p>
        </div>
      </div>

      {/* Security */}
      <Section
        icon={ShieldCheck}
        title="Security"
        desc="Add an extra layer of protection to your account."
      >
        <div className="flex items-center justify-between gap-4 bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <div className="min-w-0">
            <div className="text-white font-semibold text-sm">Two-Factor Authentication (2FA)</div>
            <div className="text-gray-500 text-xs mt-0.5">
              Require a one-time code in addition to your password when signing in.
            </div>
          </div>
          <span className="flex-shrink-0 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
            Coming soon
          </span>
        </div>
      </Section>

      {/* Blocked users */}
      <Section
        icon={Ban}
        title="Blocked Users"
        desc="People you block won't appear in search or discovery, and can't message you."
      >
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="bg-gray-900 rounded-2xl border border-gray-800 p-5 animate-pulse flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-800" />
                <div className="space-y-2">
                  <div className="w-28 h-4 bg-gray-800 rounded" />
                  <div className="w-20 h-3 bg-gray-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : blockedList.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
            <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Ban size={24} className="text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium text-sm">No blocked users</p>
            <p className="text-gray-600 text-xs mt-1">
              You can block someone from their profile. They'll show up here so you can unblock them later.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {blockedList.map(entry => {
              const person = entry.profile;
              if (!person) return null;
              return (
                <div key={entry.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-5 flex items-center justify-between gap-4">
                  <button onClick={() => onViewProfile(person.id)} className="flex items-center gap-3 group min-w-0">
                    <Avatar profile={person} />
                    <div className="min-w-0 text-left">
                      <div className="text-white font-semibold text-sm group-hover:text-blue-400 transition truncate">{person.full_name}</div>
                      <div className="text-gray-500 text-xs truncate">
                        {person.role && person.company
                          ? `${person.role} at ${person.company}`
                          : `@${person.username}`}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => unblockUser(entry.blocked_id)}
                    disabled={actionLoading === entry.blocked_id}
                    className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg px-3 py-2 text-sm transition disabled:opacity-50 flex-shrink-0"
                  >
                    <UserCheck size={14} />
                    {actionLoading === entry.blocked_id ? 'Unblocking...' : 'Unblock'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Ban;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2.5 mb-1">
        <Icon size={18} className="text-blue-400" />
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      <p className="text-gray-500 text-sm mb-4">{desc}</p>
      {children}
    </section>
  );
}

function Avatar({ profile }: { profile: Profile }) {
  return (
    <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center overflow-hidden flex-shrink-0">
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-blue-400 font-semibold text-base">
          {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
        </span>
      )}
    </div>
  );
}
