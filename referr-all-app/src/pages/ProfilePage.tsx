import { useState, useEffect, useRef } from 'react';
import {
  Briefcase, Building, Camera, Crown, Edit2, ExternalLink, Link, Loader,
  MapPin, MessageSquare, Plus, Save, ShieldBan, Star, Tag, Trash2, UserCheck,
  UserPlus, Wifi, X,
} from 'lucide-react';
import CreateSeekerPostModal from '../components/CreateSeekerPostModal';
import CreateJobPostModal from '../components/CreateJobPostModal';
import * as api from '../lib/api';
import { compressImageForUpload } from '../lib/resizeImage';
import { isPremiumActive, storePendingPremiumSession, confirmPremiumReturn, PENDING_PREMIUM_SESSION_KEY } from '../lib/premium';
import type { Profile, Post, Connection, SeekerPost } from '../lib/types';
import { AVAILABILITY_LABELS } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  userId: string;
  onMessage: (userId: string) => void;
};

export default function ProfilePage({ userId, onMessage }: Props) {
  const { user, profile: myProfile, refreshProfile, premiumConfirmError } = useAuth();
  const isOwn = user?.id === userId;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [seekerPosts, setSeekerPosts] = useState<SeekerPost[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [upgradeError, setUpgradeError] = useState('');
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [upgradingPostId, setUpgradingPostId] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showCreateSeeker, setShowCreateSeeker] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    full_name: '',
    bio: '',
    company: '',
    role: '',
    location: '',
    linkedin_url: '',
    portfolio_url: '',
    years_experience: '',
    skills: '',
    interests: '',
    avatar_url: '',
  });

  useEffect(() => {
    loadProfile();
  }, [userId]);

  async function loadProfile() {
    setLoading(true);
    try {
      const p = await api.getProfile(userId);
      const [allPosts, allSeeker, allConns, blockCheck] = await Promise.all([
        api.listPosts(),
        api.listSeekerPosts(),
        user && !isOwn ? api.listConnections() : Promise.resolve([] as Connection[]),
        user && !isOwn ? api.checkBlock(userId) : Promise.resolve({ blocked: false, id: null }),
      ]);
      const userPosts = allPosts.filter(x => x.author_id === userId);
      const userSeekerPosts = allSeeker.filter(x => x.author_id === userId);
      const conn = user && !isOwn
        ? allConns.find(c =>
            (c.requester_id === user.id || c.addressee_id === user.id) &&
            (c.requester_id === userId || c.addressee_id === userId),
          ) ?? null
        : null;

      setProfile(p);
      setPosts(userPosts);
      setSeekerPosts(userSeekerPosts);
      setConnection(conn);
      setIsBlocked(blockCheck.blocked);

      if (isOwn && userSeekerPosts.some(sp => !isPremiumActive(sp))) {
        try {
          const synced = await api.reconcilePremiumPayments();
          if (synced.activated > 0) {
            const refreshedSeeker = await api.listSeekerPosts();
            setSeekerPosts(refreshedSeeker.filter(x => x.author_id === userId));
          }
        } catch {
          /* Stripe sync is best-effort */
        }
      }

      setForm({
        full_name: p.full_name || '',
        bio: p.bio || '',
        company: p.company || '',
        role: p.role || '',
        location: p.location || '',
        linkedin_url: p.linkedin_url || '',
        portfolio_url: p.portfolio_url || '',
        years_experience: String(p.years_experience || ''),
        skills: (p.skills || []).join(', '),
        interests: (p.interests || []).join(', '),
        avatar_url: p.avatar_url || '',
      });
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setAvatarUploading(true);
    setAvatarError('');
    try {
      const prepared = await compressImageForUpload(file);
      const { url } = await api.uploadAvatar(prepared);
      const publicUrl = url.startsWith('data:') ? url : `${url}?t=${Date.now()}`;
      await api.updateProfile({ avatarUrl: publicUrl });
      setForm(f => ({ ...f, avatar_url: publicUrl }));
      setProfile(p => p ? { ...p, avatar_url: publicUrl } : p);
      await refreshProfile();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Avatar upload failed');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    setSaveError('');
    try {
      const skills = form.skills.split(',').map(s => s.trim()).filter(Boolean);
      const interests = form.interests.split(',').map(s => s.trim()).filter(Boolean);
      await api.updateProfile({
        fullName: form.full_name.trim(),
        bio: form.bio.trim(),
        company: form.company.trim(),
        role: form.role.trim(),
        location: form.location.trim(),
        linkedinUrl: form.linkedin_url.trim(),
        portfolioUrl: form.portfolio_url.trim(),
        yearsExperience: parseFloat(form.years_experience) || 0,
        skills,
        interests,
      });
      await Promise.all([loadProfile(), refreshProfile()]);
      setEditing(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    if (!user) return;
    setActionLoading(true);
    if (!connection) {
      await api.createConnection(userId);
    } else if (connection.status === 'accepted') {
      await api.deleteConnection(connection.id);
    }
    await loadProfile();
    setActionLoading(false);
  }

  async function handleBlock() {
    if (!user) return;
    setBlockLoading(true);
    if (isBlocked) {
      await api.deleteBlock(userId);
      setIsBlocked(false);
    } else {
      if (!confirm('Block this user? They will not be notified, but you will no longer see their content.')) {
        setBlockLoading(false);
        return;
      }
      await api.createBlock(userId);
      setIsBlocked(true);
    }
    setBlockLoading(false);
  }

  function timeAgo(date: string) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  async function handleDeleteSeekerPost(postId: string) {
    const post = seekerPosts.find(p => p.id === postId);
    const featured = post && isPremiumActive(post);
    const msg = featured
      ? 'Delete this featured seeker post? Unused featured time will be refunded minus a 3% processing fee.'
      : 'Are you sure you want to delete this seeker post? This cannot be undone.';
    if (!confirm(msg)) return;
    setDeletingPostId(postId);
    setUpgradeError('');
    try {
      const result = await api.deleteSeekerPost(postId);
      setSeekerPosts(prev => prev.filter(p => p.id !== postId));
      if (result.refundCents && result.refundCents > 0) {
        setUpgradeError(`Refund issued: $${(result.refundCents / 100).toFixed(2)} for unused featured time.`);
      }
    } catch (err) {
      console.error('Failed to delete seeker post:', err);
      setUpgradeError(err instanceof Error ? err.message : 'Failed to delete seeker post');
    } finally {
      setDeletingPostId(null);
    }
  }

  async function handleSyncPremiumPayments() {
    setUpgradeError('');
    setUpgradingPostId('sync');
    try {
      const result = await api.reconcilePremiumPayments();
      if (result.activated > 0) {
        await loadProfile();
      } else {
        setUpgradeError('No unfulfilled featured payments found in the last 30 days.');
      }
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Could not sync payments');
    } finally {
      setUpgradingPostId(null);
    }
  }

  async function handleRetryFeaturedActivation() {
    setUpgradeError('');
    setUpgradingPostId('retry');
    try {
      const result = await confirmPremiumReturn();
      if (result.confirmed) {
        await loadProfile();
      } else {
        setUpgradeError(result.error || 'Could not activate featured status. Try refreshing after a minute.');
      }
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Could not activate featured status');
    } finally {
      setUpgradingPostId(null);
    }
  }

  async function handleUpgradeToPremium(postId: string) {
    setUpgradingPostId(postId);
    setUpgradeError('');
    try {
      const origin = window.location.origin;
      const json = await api.createPremiumCheckout({
        seekerPostId: postId,
        successUrl: api.premiumCheckoutSuccessUrl(origin),
        cancelUrl: `${origin}/referr-all/`,
      });
      if (!json.url) throw new Error('Failed to create checkout session');
      if (json.sessionId) storePendingPremiumSession(json.sessionId);
      window.location.href = json.url;
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setUpgradingPostId(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto pb-20 md:pb-0">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 animate-pulse">
          <div className="flex items-center gap-5 mb-6">
            <div className="w-20 h-20 rounded-full bg-gray-800" />
            <div className="space-y-3">
              <div className="w-40 h-5 bg-gray-800 rounded" />
              <div className="w-28 h-4 bg-gray-800 rounded" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="w-full h-4 bg-gray-800 rounded" />
            <div className="w-3/4 h-4 bg-gray-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <p className="text-gray-400">Profile not found.</p>
      </div>
    );
  }

  const connStatus = connection?.status;
  const isRequester = connection?.requester_id === user?.id;

  const activeSeekerPosts = seekerPosts.filter(p => isPremiumActive(p) || !p.is_premium);

  return (
    <div className="max-w-2xl mx-auto pb-20 md:pb-0 space-y-5">
      {/* Profile card */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-blue-600/30 via-cyan-500/20 to-gray-900" />

        <div className="px-6 pb-6">
          <div className="flex items-end justify-between -mt-10 mb-4">
            {/* Avatar */}
            <div className="relative group">
              <div className="w-20 h-20 rounded-full bg-blue-500/20 border-4 border-gray-900 flex items-center justify-center overflow-hidden">
                {form.avatar_url || profile.avatar_url ? (
                  <img src={form.avatar_url || profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-blue-400 font-bold text-3xl">
                    {profile.full_name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                )}
                {avatarUploading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-full">
                    <Loader size={18} className="text-white animate-spin" />
                  </div>
                )}
              </div>
              {isOwn && (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="absolute bottom-0 right-0 w-7 h-7 bg-blue-500 hover:bg-blue-400 border-2 border-gray-900 rounded-full flex items-center justify-center transition disabled:opacity-50"
                    title="Upload photo"
                  >
                    <Camera size={13} className="text-white" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </>
              )}
            </div>
            {avatarError && (
              <p className="text-red-400 text-xs mt-2 max-w-xs">{avatarError}</p>
            )}

            <div className="flex items-center gap-2 mt-2">
              {isOwn ? (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium rounded-xl px-4 py-2 text-sm transition"
                >
                  <Edit2 size={14} />
                  Edit Profile
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onMessage(userId)}
                    className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium rounded-xl px-4 py-2 text-sm transition"
                  >
                    <MessageSquare size={14} />
                    Message
                  </button>
                  {connStatus === 'accepted' ? (
                    <button
                      onClick={handleConnect}
                      disabled={actionLoading}
                      className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium rounded-xl px-4 py-2 text-sm transition hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
                    >
                      <UserCheck size={14} />
                      Connected
                    </button>
                  ) : connStatus === 'pending' ? (
                    <button disabled className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium rounded-xl px-4 py-2 text-sm opacity-70">
                      {isRequester ? 'Request Sent' : 'Pending'}
                    </button>
                  ) : (
                    <button
                      onClick={handleConnect}
                      disabled={actionLoading}
                      className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl px-4 py-2 text-sm transition disabled:opacity-50"
                    >
                      <UserPlus size={14} />
                      Connect
                    </button>
                  )}
                  <button
                    onClick={handleBlock}
                    disabled={blockLoading}
                    className={`flex items-center gap-2 font-medium rounded-xl px-3 py-2 text-sm transition disabled:opacity-50 ${
                      isBlocked
                        ? 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20'
                        : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-500 hover:text-red-400'
                    }`}
                    title={isBlocked ? 'Unblock user' : 'Block user'}
                  >
                    <ShieldBan size={14} />
                    {isBlocked ? 'Blocked' : 'Block'}
                  </button>
                </>
              )}
            </div>
          </div>

          <div>
            <h1 className="text-xl font-bold text-white">{profile.full_name}</h1>
            <p className="text-gray-400 text-sm mt-0.5">@{profile.username}</p>

            {(profile.role || profile.company) && (
              <div className="flex items-center gap-1.5 text-gray-400 text-sm mt-2">
                <Briefcase size={13} className="text-gray-500" />
                <span>{[profile.role, profile.company].filter(Boolean).join(' at ')}</span>
              </div>
            )}

            {profile.location && (
              <div className="flex items-center gap-1.5 text-gray-500 text-sm mt-1">
                <MapPin size={13} />
                <span>{profile.location}</span>
              </div>
            )}

            {profile.linkedin_url && (
              <a
                href={profile.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 text-sm mt-1 hover:text-blue-300 transition"
              >
                <Link size={13} />
                LinkedIn Profile
              </a>
            )}

            {profile.portfolio_url && (
              <a
                href={profile.portfolio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 text-sm mt-1 hover:text-blue-300 transition"
              >
                <ExternalLink size={13} />
                Portfolio
              </a>
            )}

            {profile.bio && (
              <p className="text-gray-300 text-sm mt-4 leading-relaxed">{profile.bio}</p>
            )}

            {profile.years_experience > 0 && (
              <div className="flex items-center gap-1.5 text-gray-500 text-sm mt-3">
                <span className="text-gray-400 font-medium">{profile.years_experience}</span>
                <span>years of experience</span>
              </div>
            )}

            {profile.skills && profile.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {profile.skills.map(skill => (
                  <span key={skill} className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg">
                    {skill}
                  </span>
                ))}
              </div>
            )}

            {profile.interests && profile.interests.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Interests/Music/Movie/Games</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.interests.map(item => (
                    <span key={item} className="text-xs bg-purple-500/10 border border-purple-500/20 text-purple-300 px-2.5 py-1 rounded-lg">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Seeker Posts */}
      {(activeSeekerPosts.length > 0 || isOwn) && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-white">
              {isOwn ? 'My Seeker Posts' : 'Open to Work'}
              <span className="text-gray-600 font-normal text-base ml-2">({activeSeekerPosts.length})</span>
            </h2>
            {isOwn && activeSeekerPosts.length === 0 && (
              <button
                onClick={() => setShowCreateSeeker(true)}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-xl px-4 py-2 text-sm transition"
              >
                <Plus size={14} />
                Create Seeker Post
              </button>
            )}
          </div>
          {upgradeError && (
            <div className={`mb-4 text-sm rounded-lg px-4 py-3 border ${
              upgradeError.startsWith('Refund issued')
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>{upgradeError}</div>
          )}

          {activeSeekerPosts.length === 0 ? (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
              <Star size={24} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm mb-4">No seeker post yet. Let employers know you are open to work.</p>
              {isOwn && (
                <button
                  onClick={() => setShowCreateSeeker(true)}
                  className="inline-flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-medium rounded-xl px-4 py-2.5 text-sm transition"
                >
                  <Plus size={14} />
                  Create Seeker Post
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {activeSeekerPosts.map(post => {
                const premiumActive = isPremiumActive(post);
                return (
                  <div
                    key={post.id}
                    className={`bg-gray-900 rounded-2xl border p-5 ${premiumActive ? 'border-amber-400/40' : 'border-gray-800'}`}
                  >
                    {premiumActive && (
                      <div className="flex items-center gap-1.5 mb-3">
                        <Star size={12} className="text-amber-400 fill-amber-400" />
                        <span className="text-amber-400 text-xs font-semibold tracking-wide uppercase">Featured</span>
                      </div>
                    )}
                    <h3 className="text-white font-semibold mb-1">{post.headline}</h3>
                    <p className="text-blue-400 text-sm mb-2">{post.desired_role}</p>
                    <p className="text-gray-400 text-sm leading-relaxed mb-3 line-clamp-3">{post.about}</p>

                    <div className="flex flex-wrap gap-2 mb-3">
                      {post.desired_location && (
                        <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800 px-2.5 py-1.5 rounded-lg">
                          <MapPin size={11} /> {post.desired_location}
                        </span>
                      )}
                      {post.open_to_remote && (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg">
                          <Wifi size={11} /> Remote
                        </span>
                      )}
                      {post.availability && (
                        <span className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-800 px-2.5 py-1.5 rounded-lg">
                          {AVAILABILITY_LABELS[post.availability] || post.availability}
                        </span>
                      )}
                    </div>

                    {post.skills && post.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {post.skills.map(skill => (
                          <span key={skill} className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-md">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}

                    {isOwn && (
                      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-800">
                        {!premiumActive && (
                          <>
                            <button
                              onClick={() => handleUpgradeToPremium(post.id)}
                              disabled={upgradingPostId === post.id}
                              className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-medium rounded-xl px-4 py-2 text-sm transition disabled:opacity-50"
                            >
                              {upgradingPostId === post.id ? (
                                <Loader size={13} className="animate-spin" />
                              ) : (
                                <Crown size={13} />
                              )}
                              Upgrade to Premium
                            </button>
                            {(premiumConfirmError || localStorage.getItem(PENDING_PREMIUM_SESSION_KEY)) && (
                              <button
                                onClick={handleRetryFeaturedActivation}
                                disabled={upgradingPostId === 'retry'}
                                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium rounded-xl px-4 py-2 text-sm transition disabled:opacity-50"
                              >
                                {upgradingPostId === 'retry' ? (
                                  <Loader size={13} className="animate-spin" />
                                ) : (
                                  <Star size={13} />
                                )}
                                Restore featured status
                              </button>
                            )}
                            <button
                              onClick={handleSyncPremiumPayments}
                              disabled={upgradingPostId === 'sync'}
                              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium rounded-xl px-4 py-2 text-sm transition disabled:opacity-50"
                            >
                              {upgradingPostId === 'sync' ? (
                                <Loader size={13} className="animate-spin" />
                              ) : (
                                <Crown size={13} />
                              )}
                              Sync payments
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteSeekerPost(post.id)}
                          disabled={deletingPostId === post.id}
                          className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-medium rounded-xl px-4 py-2 text-sm transition disabled:opacity-50 ml-auto"
                        >
                          {deletingPostId === post.id ? (
                            <Loader size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Referral Posts */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-white">
            {isOwn ? 'My Referral Posts' : `${profile.full_name}'s Posts`}
            <span className="text-gray-600 font-normal text-base ml-2">({posts.length})</span>
          </h2>
          {isOwn && (
            <button
              onClick={() => setShowCreateJob(true)}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl px-4 py-2 text-sm transition"
            >
              <Plus size={14} />
              Create Referral Job Post
            </button>
          )}
        </div>

        {posts.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-10 text-center">
            <Briefcase size={28} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-4">{isOwn ? "You haven't posted any openings yet." : 'No posts yet.'}</p>
            {isOwn && (
              <button
                onClick={() => setShowCreateJob(true)}
                className="inline-flex items-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 font-medium rounded-xl px-4 py-2.5 text-sm transition"
              >
                <Plus size={14} />
                Create Referral Job Post
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map(post => (
              <div key={post.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
                    <Building size={18} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold">{post.role_title}</h3>
                    <p className="text-blue-400 text-sm">{post.company}</p>
                  </div>
                  <span className="text-gray-600 text-xs flex-shrink-0">{timeAgo(post.created_at)}</span>
                </div>

                <p className="text-gray-400 text-sm leading-relaxed mb-3 line-clamp-3">{post.description}</p>

                <div className="flex flex-wrap gap-2 mb-3">
                  {post.location && (
                    <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800 px-2.5 py-1.5 rounded-lg">
                      <MapPin size={11} /> {post.location}
                    </span>
                  )}
                  {post.is_remote && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg">
                      <Wifi size={11} /> Remote
                    </span>
                  )}
                  {post.required_skills?.slice(0, 5).map(skill => (
                    <span key={skill} className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1.5 rounded-lg">
                      {skill}
                    </span>
                  ))}
                </div>

                {post.tags && post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {post.tags.map(tag => (
                      <span key={tag} className="flex items-center gap-1 text-xs text-gray-400 bg-gray-800/80 border border-gray-700/50 px-2 py-1 rounded-md">
                        <Tag size={9} /> {tag}
                      </span>
                    ))}
                  </div>
                )}

                {post.job_url && (
                  <a href={post.job_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 justify-center w-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 font-medium rounded-xl py-2 text-sm transition">
                    <ExternalLink size={13} /> View Job
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-800 sticky top-0 bg-gray-900">
              <h2 className="text-lg font-bold text-white">Edit Profile</h2>
              <button onClick={() => { setEditing(false); setSaveError(''); }} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Full Name</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Role</label>
                  <input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    placeholder="Software Engineer"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Company</label>
                  <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="Google"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Location</label>
                  <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="San Francisco, CA"
                    className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Years Experience</label>
                  <input type="number" min="0" max="50" step="0.1" value={form.years_experience} onChange={e => setForm(f => ({ ...f, years_experience: e.target.value }))}
                    placeholder="5"
                    className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Bio</label>
                <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                  placeholder="Tell people a bit about yourself..."
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Skills</label>
                <input value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))}
                  placeholder="React, TypeScript, Python (comma separated)"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Interests/Music/Movie/Games</label>
                <input value={form.interests} onChange={e => setForm(f => ({ ...f, interests: e.target.value }))}
                  placeholder="Hiking, Diablo IV, sci-fi movies (comma separated)"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">LinkedIn URL</label>
                <input value={form.linkedin_url} onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))}
                  placeholder="https://linkedin.com/in/yourname"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Portfolio URL</label>
                <input value={form.portfolio_url} onChange={e => setForm(f => ({ ...f, portfolio_url: e.target.value }))}
                  placeholder="https://yoursite.com or GitHub link"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>

              {saveError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">{saveError}</div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setEditing(false); setSaveError(''); }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl py-3 text-sm transition">
                  Cancel
                </button>
                <button onClick={saveProfile} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition">
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateSeeker && (
        <CreateSeekerPostModal
          onClose={() => setShowCreateSeeker(false)}
          onCreated={() => {
            setShowCreateSeeker(false);
            loadProfile();
          }}
        />
      )}

      {showCreateJob && (
        <CreateJobPostModal
          onClose={() => setShowCreateJob(false)}
          onCreated={() => {
            setShowCreateJob(false);
            loadProfile();
          }}
        />
      )}
    </div>
  );
}
