import { useState, useEffect } from 'react';
import * as api from '../lib/api';
import type { Post, Profile, SeekerPost } from '../lib/types';
import { AVAILABILITY_LABELS } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';
import { isPremiumActive } from '../lib/premium';
import {
  Plus, Briefcase, MapPin, ExternalLink, MessageSquare,
  Wifi, X, ChevronDown, Search, Tag, Building, Star,
  User, Filter, ChevronRight, Flag
} from 'lucide-react';
import CreateJobPostModal from '../components/CreateJobPostModal';
import CreateSeekerPostModal from '../components/CreateSeekerPostModal';
import { computeMatchScore, isUsaLocation, matchPercent } from '../lib/feedMatch';
import { US_STATES } from '../lib/usStates';

const FIELDS_OF_WORK = [
  'Engineering','Design','Product','Marketing','Sales','Finance','Operations',
  'HR / People','Legal','Data / Analytics','DevOps / Infrastructure','Customer Success',
  'Healthcare','Education','Real Estate','Consulting','Research','IT','Support','Other',
];

type FeedTab = 'openings' | 'seekers';

type Props = {
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string) => void;
};

export default function FeedPage({ onViewProfile, onMessage }: Props) {
  const { user, profile, featuredReturn, premiumConfirmError, premiumConfirmed } = useAuth();
  const [tab, setTab] = useState<FeedTab>('openings');
  const [posts, setPosts] = useState<(Post & { profiles: Profile })[]>([]);
  const [seekerPosts, setSeekerPosts] = useState<(SeekerPost & { profiles: Profile })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showCreateSeeker, setShowCreateSeeker] = useState(false);
  const hasOwnSeekerPost = !!user?.id && seekerPosts.some(p => p.author_id === user.id);
  const [showFilters, setShowFilters] = useState(false);
  const [showFeaturedBanner, setShowFeaturedBanner] = useState(false);

  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterField, setFilterField] = useState('');
  const [filterRemote, setFilterRemote] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (!featuredReturn || loading) return;
    setTab('seekers');
    const ownFeatured = seekerPosts.some(
      p => p.author_id === user?.id && isPremiumActive(p),
    );
    if (premiumConfirmed && ownFeatured) {
      setShowFeaturedBanner(true);
      const timer = setTimeout(() => setShowFeaturedBanner(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [featuredReturn, premiumConfirmError, premiumConfirmed, loading, seekerPosts, user?.id]);

  async function fetchAll() {
    setLoading(true);
    if (featuredReturn && !premiumConfirmed) {
      try {
        await api.reconcilePremiumPayments();
      } catch {
        /* best-effort */
      }
    }
    const [jobData, seekerData] = await Promise.all([
      api.listPosts(),
      api.listSeekerPosts(),
    ]);
    setPosts((jobData as (Post & { profiles: Profile })[]) || []);
    setSeekerPosts((seekerData as (SeekerPost & { profiles: Profile })[]) || []);
    setLoading(false);
  }

  function matchesFilters(location: string, field: string, isRemote: boolean) {
    if (!isUsaLocation(location, isRemote)) return false;
    if (filterRemote && !isRemote) return false;
    if (filterState && filterState !== 'Remote (USA)') {
      if (!location.toLowerCase().includes(filterState.toLowerCase()) && !(filterRemote && isRemote)) return false;
    }
    if (filterState === 'Remote (USA)' && !isRemote) return false;
    if (filterField && field.toLowerCase() !== filterField.toLowerCase()) return false;
    return true;
  }

  function sortByMatch<T extends { is_premium?: boolean; premium_expires_at?: string | null }>(
    items: T[],
    scoreFor: (item: T) => number,
  ): T[] {
    return [...items].sort((a, b) => {
      const premiumA = isPremiumActive(a);
      const premiumB = isPremiumActive(b);
      if (premiumA !== premiumB) return premiumA ? -1 : 1;
      return scoreFor(b) - scoreFor(a);
    });
  }

  const filteredJobs = sortByMatch(
    posts.filter(p => {
      const q = search.toLowerCase();
      const textMatch = !q || p.company.toLowerCase().includes(q) || p.role_title.toLowerCase().includes(q) || p.profiles?.full_name?.toLowerCase().includes(q);
      return textMatch && matchesFilters(p.location || '', p.tags?.join(' ') || '', p.is_remote);
    }),
    p => computeMatchScore(profile, p),
  );

  const filteredSeekers = sortByMatch(
    seekerPosts.filter(p => {
      const q = search.toLowerCase();
      const textMatch = !q || p.desired_role.toLowerCase().includes(q) || p.profiles?.full_name?.toLowerCase().includes(q) || p.field_of_work?.toLowerCase().includes(q) || (p.skills || []).some(s => s.toLowerCase().includes(q)) || p.about.toLowerCase().includes(q);
      return textMatch && matchesFilters(p.desired_location || '', p.field_of_work || '', p.open_to_remote);
    }),
    p => computeMatchScore(profile, p),
  );

  const hasActiveFilters = filterState || filterField || filterRemote;

  return (
    <div className="max-w-2xl mx-auto pb-20 md:pb-0 min-w-0 w-full">
      {/* Featured payment success banner */}
      {showFeaturedBanner && (
        <div className="mb-5 flex items-center gap-3 bg-amber-500/10 border border-amber-400/30 rounded-xl px-4 py-3 min-w-0">
          <Star size={16} className="text-amber-400 fill-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-sm font-medium flex-1 min-w-0">Your post is now featured! It will appear at the top of the Seekers feed for 30 days.</p>
          <button onClick={() => setShowFeaturedBanner(false)} className="text-amber-400/60 hover:text-amber-300 transition"><X size={16} /></button>
        </div>
      )}
      {featuredReturn && premiumConfirmError && (
        <div className="mb-5 bg-red-500/10 border border-red-400/30 rounded-xl px-4 py-3">
          <p className="text-red-300 text-sm break-words">
            {premiumConfirmError} Check Stripe webhook URL is exactly{' '}
            <span className="font-mono text-red-200 break-all">https://rorhoff.com/api/referr-all/premium/webhook</span>
            {' '}(not romoff.com). Then open Profile and click Sync payments.
          </p>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Referral Feed</h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5">USA opportunities · ranked by skills</p>
        </div>
        <div className="relative group flex-shrink-0 self-start sm:self-auto">
          <button className="flex items-center gap-1.5 sm:gap-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-3 sm:px-4 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-blue-500/20">
            <Plus size={16} />
            Post
            <ChevronDown size={14} />
          </button>
          <div className="absolute right-0 top-full mt-1.5 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-30 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
            <button
              onClick={() => setShowCreateJob(true)}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-t-xl transition"
            >
              <Briefcase size={15} className="text-blue-400" />
              <div className="text-left">
                <div className="font-medium">Post Job Opening</div>
                <div className="text-xs text-gray-500">Share a referral opportunity</div>
              </div>
            </button>
            <div className="border-t border-gray-800" />
            <button
              onClick={() => {
                if (hasOwnSeekerPost) {
                  alert('You already have a seeker post. Delete it from your profile before creating a new one.');
                  return;
                }
                setShowCreateSeeker(true);
              }}
              disabled={hasOwnSeekerPost}
              className={`flex items-center gap-3 w-full px-4 py-3 text-sm rounded-b-xl transition ${
                hasOwnSeekerPost
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-gray-300 hover:text-white hover:bg-gray-800'
              }`}
            >
              <User size={15} className="text-emerald-400" />
              <div className="text-left">
                <div className="font-medium">Post Yourself</div>
                <div className="text-xs text-gray-500">Let employers find you</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-4 border border-gray-800 min-w-0 overflow-hidden">
        <button
          onClick={() => setTab('openings')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${tab === 'openings' ? 'bg-blue-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
        >
          <Briefcase size={14} className="flex-shrink-0 hidden sm:block" />
          <span className="truncate"><span className="sm:hidden">Openings</span><span className="hidden sm:inline">Job Openings</span></span>
          <span className={`flex-shrink-0 text-xs rounded-full px-1.5 py-0.5 ${tab === 'openings' ? 'bg-white/20' : 'bg-gray-700 text-gray-400'}`}>{posts.length}</span>
        </button>
        <button
          onClick={() => setTab('seekers')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${tab === 'seekers' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
        >
          <User size={14} className="flex-shrink-0" />
          <span className="truncate"><span className="sm:hidden">Seekers</span><span className="hidden sm:inline">Job Seekers</span></span>
          <span className={`flex-shrink-0 text-xs rounded-full px-1.5 py-0.5 ${tab === 'seekers' ? 'bg-white/20' : 'bg-gray-700 text-gray-400'}`}>{seekerPosts.length}</span>
        </button>
      </div>

      {/* Search + Filter row */}
      <div className="flex gap-2 mb-3 min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'openings' ? 'Search company, role...' : 'Search role, skills, name...'}
            className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-10 pr-4 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-label="Filters"
          className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2.5 rounded-xl text-sm font-medium border transition ${
            hasActiveFilters
              ? 'bg-blue-500/10 border-blue-500/40 text-blue-400'
              : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
          }`}
        >
          <Filter size={15} />
          <span className="hidden sm:inline">Filters</span>
          {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">State / Region</label>
              <select
                value={filterState}
                onChange={e => setFilterState(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">All Locations</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Field of Work</label>
              <select
                value={filterField}
                onChange={e => setFilterField(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">All Fields</option>
                {FIELDS_OF_WORK.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setFilterRemote(!filterRemote)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                filterRemote ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-400'
              }`}
            >
              <Wifi size={13} />
              Remote Only
            </button>
            {hasActiveFilters && (
              <button
                onClick={() => { setFilterState(''); setFilterField(''); setFilterRemote(false); }}
                className="text-xs text-gray-500 hover:text-white transition"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Feed */}
      {loading ? (
        <LoadingSkeleton />
      ) : tab === 'openings' ? (
        filteredJobs.length === 0 ? (
          <EmptyState icon={Briefcase} title="No job openings found" desc="Try adjusting your filters, or post the first opening!" />
        ) : (
          <div className="space-y-4">
            {filteredJobs.map(post => (
              <JobPostCard key={post.id} post={post} currentUserId={user?.id} onViewProfile={onViewProfile} onMessage={onMessage} onDeleted={fetchAll} matchScore={matchPercent(computeMatchScore(profile, post))} />
            ))}
          </div>
        )
      ) : (
        filteredSeekers.length === 0 ? (
          <EmptyState icon={User} title="No job seekers found" desc="Try adjusting your filters, or post yourself as available!" />
        ) : (
          <div className="space-y-4">
            {filteredSeekers.map(post => (
              <SeekerPostCard key={post.id} post={post} currentUserId={user?.id} onViewProfile={onViewProfile} onDeleted={fetchAll} onBoostDone={fetchAll} matchScore={matchPercent(computeMatchScore(profile, post))} />
            ))}
          </div>
        )
      )}

      {showCreateJob && <CreateJobPostModal onClose={() => setShowCreateJob(false)} onCreated={fetchAll} />}
      {showCreateSeeker && <CreateSeekerPostModal onClose={() => setShowCreateSeeker(false)} onCreated={fetchAll} />}
    </div>
  );
}

// ─── Job Post Card ────────────────────────────────────────────────────────────

function JobPostCard({
  post, currentUserId, onViewProfile, onMessage, onDeleted, matchScore = 0
}: {
  post: Post & { profiles: Profile };
  currentUserId?: string;
  onViewProfile: (id: string) => void;
  onMessage: (id: string) => void;
  onDeleted: () => void;
  matchScore?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const p = post.profiles;

  function timeAgo(date: string) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 hover:border-gray-700 transition-colors overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <button onClick={() => onViewProfile(post.author_id)} className="flex items-center gap-3 group">
            <div className="w-11 h-11 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center overflow-hidden flex-shrink-0">
              {p?.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : <span className="text-blue-400 font-semibold">{p?.full_name?.charAt(0)?.toUpperCase() || '?'}</span>}
            </div>
            <div className="text-left">
              <div className="text-white font-semibold text-sm group-hover:text-blue-400 transition">{p?.full_name}</div>
              <div className="text-gray-500 text-xs">{p?.role && p?.company ? `${p.role} at ${p.company}` : p?.company || `@${p?.username}`}</div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {matchScore > 0 && (
              <span className="text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full">{matchScore}% match</span>
            )}
            <span className="text-gray-600 text-xs">{timeAgo(post.created_at)}</span>
            {currentUserId && currentUserId !== post.author_id && (
              <ReportFlagButton postId={post.id} kind="job" onRemoved={onDeleted} />
            )}
            {currentUserId === post.author_id && (
              <button onClick={async () => { if (confirm('Delete this post?')) { await api.deletePost(post.id); onDeleted(); } }} className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
            <Building size={22} className="text-gray-400" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">{post.role_title}</h3>
            <p className="text-blue-400 font-medium text-sm">{post.company}</p>
          </div>
        </div>

        <p className={`text-gray-400 text-sm leading-relaxed mb-4 ${!expanded && 'line-clamp-3'}`}>{post.description}</p>
        {post.description.length > 200 && (
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-blue-400 text-sm hover:text-blue-300 transition mb-4">
            {expanded ? 'Show less' : 'Read more'}<ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {post.location && <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800 px-2.5 py-1.5 rounded-lg"><MapPin size={11} />{post.location}</span>}
          {post.is_remote && <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg"><Wifi size={11} />Remote</span>}
          {post.required_skills?.slice(0, 5).map(skill => (
            <span key={skill} className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1.5 rounded-lg">{skill}</span>
          ))}
        </div>

        {post.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {post.tags.map(tag => <span key={tag} className="flex items-center gap-1 text-xs text-gray-400 bg-gray-800/80 border border-gray-700/50 px-2 py-1 rounded-md"><Tag size={9} />{tag}</span>)}
          </div>
        )}

        <div className="flex gap-2">
          {post.job_url && (
            <a href={post.job_url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-blue-400 font-medium rounded-xl py-2.5 text-sm transition-all">
              <ExternalLink size={14} />View Job Posting
            </a>
          )}
          {currentUserId && currentUserId !== post.author_id && (
            <button onClick={() => onMessage(post.author_id)} className="flex-1 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl py-2.5 text-sm transition">
              <MessageSquare size={14} />Message
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Seeker Post Card ─────────────────────────────────────────────────────────

function SeekerPostCard({
  post, currentUserId, onViewProfile, onDeleted, onBoostDone, matchScore = 0
}: {
  post: SeekerPost & { profiles: Profile };
  currentUserId?: string;
  onViewProfile: (id: string) => void;
  onDeleted: () => void;
  onBoostDone: () => void;
  matchScore?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const premiumActive = isPremiumActive(post);
  const p = post.profiles;

  function timeAgo(date: string) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div className={`rounded-2xl overflow-hidden transition-all ${
      premiumActive
        ? 'border-2 border-amber-400/60 shadow-lg shadow-amber-500/10 bg-gradient-to-b from-amber-500/5 to-gray-900'
        : 'bg-gray-900 border border-gray-800 hover:border-gray-700'
    }`}>
      {premiumActive && (
        <div className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-500/20 to-amber-400/10 border-b border-amber-400/20">
          <Star size={13} className="text-amber-400 fill-amber-400" />
          <span className="text-amber-300 text-xs font-semibold tracking-wide">FEATURED CANDIDATE</span>
        </div>
      )}
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <button onClick={() => onViewProfile(post.author_id)} className="flex items-center gap-3 group">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 ${premiumActive ? 'border-2 border-amber-400/60 bg-amber-500/10' : 'border border-blue-500/30 bg-blue-500/20'}`}>
              {p?.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : <span className={`font-semibold ${premiumActive ? 'text-amber-400' : 'text-blue-400'}`}>{p?.full_name?.charAt(0)?.toUpperCase() || '?'}</span>}
            </div>
            <div className="text-left">
              <div className="text-white font-semibold text-sm group-hover:text-blue-400 transition">{p?.full_name}</div>
              <div className="text-gray-500 text-xs">{p?.company ? `Currently at ${p.company}` : `@${p?.username}`}</div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {matchScore > 0 && (
              <span className="text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full">{matchScore}% match</span>
            )}
            <span className="text-gray-600 text-xs">{timeAgo(post.created_at)}</span>
            {currentUserId && currentUserId !== post.author_id && (
              <ReportFlagButton postId={post.id} kind="seeker" onRemoved={onDeleted} />
            )}
            {currentUserId === post.author_id && (
              <button onClick={async () => { if (confirm('Delete this post?')) { await api.deleteSeekerPost(post.id); onDeleted(); } }} className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <h3 className="text-white font-bold text-lg mb-1">{post.headline}</h3>
        <p className="text-emerald-400 font-medium text-sm mb-3">{post.desired_role}{post.field_of_work ? ` · ${post.field_of_work}` : ''}</p>
        <p className={`text-gray-400 text-sm leading-relaxed mb-4 ${!expanded && 'line-clamp-3'}`}>{post.about}</p>
        {post.about.length > 200 && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-blue-400 text-sm hover:text-blue-300 transition mb-4">
            {expanded ? 'Show less' : 'Read more'}<ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {post.desired_location && <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800 px-2.5 py-1.5 rounded-lg"><MapPin size={11} />{post.desired_location}</span>}
          {post.open_to_remote && <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg"><Wifi size={11} />Open to Remote</span>}
          {post.experience_years > 0 && <span className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-lg"><Briefcase size={11} />{post.experience_years} yrs exp</span>}
          <span className={`text-xs px-2.5 py-1.5 rounded-lg font-medium ${
            post.availability === 'immediately' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-400 bg-gray-800'
          }`}>{AVAILABILITY_LABELS[post.availability]}</span>
        </div>

        {post.skills?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {post.skills.slice(0, 6).map(skill => <span key={skill} className="flex items-center gap-1 text-xs text-gray-400 bg-gray-800/80 border border-gray-700/50 px-2 py-1 rounded-md"><Tag size={9} />{skill}</span>)}
            {post.skills.length > 6 && <span className="text-xs text-gray-500 px-2 py-1">+{post.skills.length - 6} more</span>}
          </div>
        )}

        <div className="flex gap-2">
          {post.resume_url && (
            <a href={post.resume_url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 font-medium rounded-xl py-2.5 text-sm transition-all">
              <ExternalLink size={13} />LinkedIn Profile
            </a>
          )}
          <button onClick={() => onViewProfile(post.author_id)} className="flex-1 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl py-2.5 text-sm transition">
            <ChevronRight size={14} />View Profile
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportFlagButton({
  postId,
  kind,
  onRemoved,
}: {
  postId: string;
  kind: 'job' | 'seeker';
  onRemoved: () => void;
}) {
  const [reported, setReported] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = kind === 'job' ? api.checkPostReported : api.checkSeekerPostReported;
    check(postId)
      .then(result => setReported(result.reported))
      .catch(() => {});
  }, [postId, kind]);

  async function handleReport() {
    if (reported || loading) return;
    if (!confirm('Report this post as inappropriate or spam?')) return;
    setLoading(true);
    try {
      const result = kind === 'job'
        ? await api.reportPost(postId)
        : await api.reportSeekerPost(postId);
      setReported(true);
      if (result.removed) onRemoved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not submit report');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleReport}
      disabled={loading || reported}
      title={reported ? 'Reported' : 'Report post'}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition disabled:opacity-60 ${
        reported
          ? 'text-red-400 bg-red-500/10'
          : 'text-gray-600 hover:text-red-400 hover:bg-red-500/10'
      }`}
    >
      <Flag size={13} className={reported ? 'fill-red-400' : ''} />
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-gray-900 rounded-2xl border border-gray-800 p-6 animate-pulse">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gray-800" />
            <div className="space-y-2"><div className="w-32 h-4 bg-gray-800 rounded" /><div className="w-24 h-3 bg-gray-800 rounded" /></div>
          </div>
          <div className="space-y-2"><div className="w-3/4 h-5 bg-gray-800 rounded" /><div className="w-full h-4 bg-gray-800 rounded" /><div className="w-2/3 h-4 bg-gray-800 rounded" /></div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc }: { icon: typeof Briefcase; title: string; desc: string }) {
  return (
    <div className="text-center py-20">
      <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Icon size={28} className="text-gray-600" />
      </div>
      <p className="text-gray-400 font-medium">{title}</p>
      <p className="text-gray-600 text-sm mt-1">{desc}</p>
    </div>
  );
}
