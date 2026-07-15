import { useState } from 'react';
import * as api from '../lib/api';
import { trackReferralSent } from '../lib/analytics';
import { useAuth } from '../contexts/AuthContext';
import { normalizeHttpUrl } from '../lib/normalizeUrl';
import { storePendingPremiumSession, storePendingPremiumPrice } from '../lib/premium';
import { X, Wifi, Star, ChevronRight } from 'lucide-react';
import type { Post } from '../lib/types';

type Step = 'form' | 'premium';

type Props = {
  onClose: () => void;
  onCreated: () => void;
  /** When provided, the modal edits this post instead of creating a new one. */
  post?: Post;
};

export default function CreateJobPostModal({ onClose, onCreated, post }: Props) {
  const { user, profile } = useAuth();
  const isEdit = !!post;
  const [step, setStep] = useState<Step>('form');
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);
  const [premiumPrice, setPremiumPrice] = useState<number | null>(null);
  const [paymentsConfigured, setPaymentsConfigured] = useState(true);

  const [form, setForm] = useState({
    company: post?.company ?? profile?.company ?? '',
    role_title: post?.role_title ?? profile?.role ?? '',
    description: post?.description ?? '',
    location: post?.location ?? profile?.location ?? '',
    is_remote: post?.is_remote ?? false,
    job_url: post?.job_url ?? '',
    tags: post ? (post.tags || []).join(', ') : '',
    required_skills: post
      ? (post.required_skills || []).join(', ')
      : (profile?.skills || []).slice(0, 5).join(', '),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);
    try {
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      const required_skills = form.required_skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
      const body = {
        company: form.company.trim(),
        roleTitle: form.role_title.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        isRemote: form.is_remote,
        jobUrl: normalizeHttpUrl(form.job_url),
        tags,
        requiredSkills: required_skills,
      };
      if (isEdit && post) {
        await api.updatePost(post.id, body);
        onCreated();
        onClose();
        return;
      }
      const created = await api.createPost(body);
      trackReferralSent();
      setCreatedPostId(created.id);
      onCreated();
      try {
        const [priceInfo, status] = await Promise.all([
          api.getJobPremiumPrice(),
          api.getReferrallStatus(),
        ]);
        setPremiumPrice(priceInfo.priceCents);
        setPaymentsConfigured(status.paymentsConfigured);
      } catch {
        setPremiumPrice(api.BASE_PREMIUM_PRICE_CENTS);
        setPaymentsConfigured(false);
      }
      setStep('premium');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePremium() {
    if (!user || !createdPostId || premiumPrice === null) return;
    setSubmitting(true);
    setError('');
    try {
      const origin = window.location.origin;
      const json = await api.createJobPremiumCheckout({
        jobPostId: createdPostId,
        successUrl: api.jobPremiumCheckoutSuccessUrl(origin),
        cancelUrl: api.premiumCheckoutCancelUrl(origin),
      });
      if (!json.url) throw new Error('Failed to create checkout session');
      storePendingPremiumPrice(premiumPrice);
      if (json.sessionId) storePendingPremiumSession(json.sessionId);
      window.location.href = json.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setSubmitting(false);
    }
  }

  const displayPrice = premiumPrice !== null ? (premiumPrice / 100).toFixed(2) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        {step === 'form' ? (
          <>
            <div className="flex items-center justify-between p-6 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
              <h2 className="text-lg font-bold text-white">{isEdit ? 'Edit Job Opening' : 'Post a Job Opening'}</h2>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Company *</label>
                  <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="e.g. Google" required
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Role Title *</label>
                  <input value={form.role_title} onChange={e => setForm(f => ({ ...f, role_title: e.target.value }))} placeholder="e.g. Software Engineer" required
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Description *</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the role and why candidates should apply..." required rows={4}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition resize-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Location</label>
                <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. San Francisco, CA"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setForm(f => ({ ...f, is_remote: !f.is_remote }))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition ${form.is_remote ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                  <Wifi size={14} />Remote
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Required Skills (top 5)</label>
                <input value={form.required_skills} onChange={e => setForm(f => ({ ...f, required_skills: e.target.value }))} placeholder="React, Python, AWS, SQL, Docker (comma separated)"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Job URL</label>
                <input value={form.job_url} onChange={e => setForm(f => ({ ...f, job_url: e.target.value }))} placeholder="jobs.company.com/role or https://..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tags</label>
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="React, TypeScript, Senior (comma separated)"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>

              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">{error}</div>}

              <button type="submit" disabled={submitting} className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition">
                {submitting ? (isEdit ? 'Saving...' : 'Posting...') : (isEdit ? 'Save Changes' : 'Post Opening')}
              </button>
            </form>
          </>
        ) : (
          /* Featured job upsell step (after creating a new post) */
          <div className="p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-amber-500/10 border-2 border-amber-400/40 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Star size={28} className="text-amber-400 fill-amber-400/30" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Your opening is live!</h2>
              <p className="text-gray-400 text-sm">Feature it to reach more candidates first.</p>
            </div>

            <div className="bg-gradient-to-b from-amber-500/10 to-transparent border-2 border-amber-400/30 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Star size={16} className="text-amber-400 fill-amber-400" />
                  <span className="text-amber-300 font-bold">Featured Job Post</span>
                </div>
                <div className="text-right">
                  <div className="text-white font-bold text-xl">${displayPrice}</div>
                  <div className="text-gray-500 text-xs">for {api.PREMIUM_DURATION_DAYS} days</div>
                </div>
              </div>

              <ul className="space-y-2 text-sm mb-5">
                {[
                  'Gold frame — instantly catches the eye',
                  'Pinned near the top of the Openings feed',
                  'Featured badge shown to all job seekers',
                  `Active for ${api.PREMIUM_DURATION_DAYS} days`,
                ].map(item => (
                  <li key={item} className="flex items-center gap-2 text-gray-300">
                    <span className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

            {!paymentsConfigured && (
              <div className="bg-amber-500/10 border border-amber-400/30 text-amber-200 text-sm rounded-lg px-4 py-3 mb-4">
                Featured checkout is not enabled on this server yet. Your standard post is already live — use
                &ldquo;No thanks&rdquo; below.
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handlePremium}
                disabled={submitting || !paymentsConfigured}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 font-bold rounded-xl py-3.5 text-sm transition shadow-lg shadow-amber-500/20"
              >
                <Star size={16} className="fill-gray-900" />
                {submitting ? 'Redirecting to payment...' : `Get Featured for $${displayPrice}`}
                <ChevronRight size={16} />
              </button>
              <button
                onClick={onClose}
                className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition"
              >
                No thanks, continue with standard post
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
