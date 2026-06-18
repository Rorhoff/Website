import { useState, useEffect, useRef } from 'react';
import * as api from '../lib/api';
import { getPremiumPrice, PREMIUM_DURATION_DAYS } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { normalizeHttpUrl } from '../lib/normalizeUrl';
import { X, Wifi, Star, ChevronRight } from 'lucide-react';

const FIELDS_OF_WORK = [
  'Engineering','Design','Product','Marketing','Sales','Finance','Operations',
  'HR / People','Legal','Data / Analytics','DevOps / Infrastructure','Customer Success',
  'Healthcare','Education','Real Estate','Consulting','Research','IT','Support','Other',
];

const AVAILABILITY_OPTIONS = [
  { value: 'immediately', label: 'Available Now' },
  { value: '2weeks', label: '2 Weeks Notice' },
  { value: '1month', label: '1 Month Notice' },
  { value: '3months', label: '3+ Months' },
];

type Step = 'form' | 'premium';

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export default function CreateSeekerPostModal({ onClose, onCreated }: Props) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<Step>('form');
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);
  const [premiumPrice, setPremiumPrice] = useState<number | null>(null);
  const [paymentsConfigured, setPaymentsConfigured] = useState(true);
  const [paymentsSetupHint, setPaymentsSetupHint] = useState('');

  const [form, setForm] = useState({
    about: profile?.bio || '',
    desired_role: '',
    desired_location: profile?.location || '',
    open_to_remote: false,
    field_of_work: '',
    skills: (profile?.skills || []).join(', '),
    experience_years: profile?.years_experience ? String(profile.years_experience) : '',
    resume_url: profile?.linkedin_url || '',
    portfolio_url: profile?.portfolio_url || '',
    availability: 'immediately',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);
    try {
      const skills = form.skills.split(',').map(s => s.trim()).filter(Boolean);
      const resumeUrl = normalizeHttpUrl(form.resume_url);
      const portfolioUrl = normalizeHttpUrl(form.portfolio_url);
      const data = await api.createSeekerPost({
        headline: form.desired_role.trim(),
        about: form.about.trim(),
        desiredRole: form.desired_role.trim(),
        desiredLocation: form.desired_location.trim(),
        openToRemote: form.open_to_remote,
        fieldOfWork: form.field_of_work,
        skills,
        experienceYears: parseFloat(form.experience_years) || 0,
        resumeUrl,
        portfolioUrl,
        availability: form.availability,
      });

      setCreatedPostId(data.id);
      onCreated();

      try {
        const [priceInfo, status] = await Promise.all([
          getPremiumPrice(),
          api.getReferrallStatus(),
        ]);
        setPremiumPrice(priceInfo.priceCents);
        setPaymentsConfigured(status.paymentsConfigured);
        setPaymentsSetupHint(status.paymentsSetupHint || '');
      } catch {
        setPremiumPrice(api.BASE_PREMIUM_PRICE_CENTS);
        try {
          const status = await api.getReferrallStatus();
          setPaymentsConfigured(status.paymentsConfigured);
          setPaymentsSetupHint(status.paymentsSetupHint || '');
        } catch {
          setPaymentsConfigured(false);
          setPaymentsSetupHint('');
        }
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
      const json = await api.createPremiumCheckout({
        seekerPostId: createdPostId,
        successUrl: api.premiumCheckoutSuccessUrl(origin),
        cancelUrl: api.premiumCheckoutCancelUrl(origin),
      });
      if (!json.url) throw new Error('Failed to create checkout session');
      window.location.href = json.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setSubmitting(false);
    }
  }

  function skipPremium() {
    onCreated();
    onClose();
  }

  const displayPrice = premiumPrice !== null ? (premiumPrice / 100).toFixed(2) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

        {step === 'form' ? (
          <>
            <div className="flex items-center justify-between p-6 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
              <h2 className="text-lg font-bold text-white">Post Yourself</h2>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div
                  ref={errorRef}
                  className="sticky top-[4.5rem] z-20 bg-red-500/15 border border-red-500/40 text-red-300 text-sm rounded-lg px-4 py-3 shadow-lg"
                >
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Desired Role *</label>
                <input value={form.desired_role} onChange={e => setForm(f => ({ ...f, desired_role: e.target.value }))}
                  placeholder="e.g. Senior Technical Support Engineer"
                  required
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                <p className="text-gray-600 text-xs mt-1">Shown as the title of your seeker post in the feed.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Field of Work</label>
                <select value={form.field_of_work} onChange={e => setForm(f => ({ ...f, field_of_work: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition">
                  <option value="">Select field</option>
                  {FIELDS_OF_WORK.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">About You *</label>
                <textarea value={form.about} onChange={e => setForm(f => ({ ...f, about: e.target.value }))}
                  placeholder="Tell employers about your background, what you're looking for, and what makes you a great hire..." required rows={4}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Desired Location (USA)</label>
                  <input value={form.desired_location} onChange={e => setForm(f => ({ ...f, desired_location: e.target.value }))}
                    placeholder="e.g. Remote, UT or Austin, TX"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Years Experience</label>
                  <input type="number" min="0" max="50" step="0.1" value={form.experience_years}
                    onChange={e => setForm(f => ({ ...f, experience_years: e.target.value }))} placeholder="5"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setForm(f => ({ ...f, open_to_remote: !f.open_to_remote }))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition ${form.open_to_remote ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                  <Wifi size={14} />Open to Remote
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Availability</label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABILITY_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, availability: opt.value }))}
                      className={`py-2 rounded-lg text-sm font-medium border transition ${form.availability === opt.value ? 'bg-blue-500/10 border-blue-500/40 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Skills</label>
                <input value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))}
                  placeholder="React, Python, SQL (comma separated)"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">LinkedIn Profile</label>
                  <input value={form.resume_url} onChange={e => setForm(f => ({ ...f, resume_url: e.target.value }))}
                    placeholder="linkedin.com/in/yourname or https://..."
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Portfolio URL</label>
                  <input value={form.portfolio_url} onChange={e => setForm(f => ({ ...f, portfolio_url: e.target.value }))}
                    placeholder="yoursite.com or https://..."
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
              </div>

              <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition">
                {submitting ? 'Posting...' : 'Post & Continue'}
              </button>
            </form>
          </>
        ) : (
          /* Premium upsell step */
          <div className="p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-amber-500/10 border-2 border-amber-400/40 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Star size={28} className="text-amber-400 fill-amber-400/30" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Your post is live!</h2>
              <p className="text-gray-400 text-sm">Stand out with a Featured Post and get seen first.</p>
            </div>

            <div className="bg-gradient-to-b from-amber-500/10 to-transparent border-2 border-amber-400/30 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Star size={16} className="text-amber-400 fill-amber-400" />
                  <span className="text-amber-300 font-bold">Featured Post</span>
                </div>
                <div className="text-right">
                  <div className="text-white font-bold text-xl">${displayPrice}</div>
                  <div className="text-gray-500 text-xs">for 30 days</div>
                </div>
              </div>

              <ul className="space-y-2 text-sm mb-5">
                {[
                  'Gold frame — instantly catches the eye',
                  'Pinned near the top of the Seekers feed',
                  'Featured badge shown to all employers',
                  `Active for ${PREMIUM_DURATION_DAYS} days`,
                ].map(item => (
                  <li key={item} className="flex items-center gap-2 text-gray-300">
                    <span className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <div className="bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2 text-xs text-amber-300/70 text-center space-y-1">
                <p>
                  Variable pricing — depending on how many featured posts there are, the price will vary.
                </p>
                <p className="text-amber-200/90 font-medium">
                  Your price today: ${displayPrice}
                </p>
              </div>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

            {!paymentsConfigured && (
              <div className="bg-amber-500/10 border border-amber-400/30 text-amber-200 text-sm rounded-lg px-4 py-3 mb-4">
                Featured checkout is not enabled on this server yet. Your standard post is already live — use
                &ldquo;No thanks&rdquo; below.
                {paymentsSetupHint ? (
                  <p className="mt-2 text-amber-200/90 text-xs leading-relaxed">{paymentsSetupHint}</p>
                ) : null}
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
                onClick={skipPremium}
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
