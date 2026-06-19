import { useState, useEffect } from 'react';
import * as api from '../lib/api';
import { trackSignup, type SignupUserType } from '../lib/analytics';
import { parseAuthHash, replaceAuthHash } from '../lib/appNav';
import { Briefcase, Users, MessageSquare, TrendingUp, ArrowLeft } from 'lucide-react';

type View = 'login' | 'register' | 'forgot' | 'reset' | 'twofa';

function initialResetToken(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('reset_token');
}

function initialAuthView(): View {
  if (initialResetToken()) return 'reset';
  return parseAuthHash() === 'register' ? 'register' : 'login';
}

function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/\d/.test(pw)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include at least one special character.';
  return null;
}

export default function AuthPage() {
  const [resetToken] = useState<string | null>(initialResetToken);
  const [view, setView] = useState<View>(initialAuthView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [twofaToken, setTwofaToken] = useState('');
  const [twofaCode, setTwofaCode] = useState('');
  const [signupUserType, setSignupUserType] = useState<SignupUserType>('job_seeker');

  function goTo(next: View) {
    setView(next);
    setError('');
    setInfo('');
    if (next === 'login' || next === 'register') {
      replaceAuthHash(next);
    }
  }

  useEffect(() => {
    if (view === 'reset' || view === 'twofa' || view === 'forgot') return;
    const onHashChange = () => {
      const fromHash = parseAuthHash();
      setView(fromHash);
      setError('');
      setInfo('');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [view]);

  function clearResetParam() {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (view === 'login') {
        const res = await api.login(email, password);
        if ('twofaRequired' in res && res.twofaRequired) {
          setTwofaToken(res.twofaToken);
          setTwofaCode('');
          goTo('twofa');
        } else {
          window.location.reload();
        }
      } else {
        if (!username.trim() || !fullName.trim()) {
          throw new Error('Please fill in all fields.');
        }
        const usernameClean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (usernameClean.length < 3) {
          throw new Error('Username must be at least 3 characters (letters, numbers, underscores).');
        }
        await api.register({
          email,
          password,
          username: usernameClean,
          fullName: fullName.trim(),
        });
        await trackSignup(signupUserType);
        window.location.reload();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify2fa(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.loginVerify2fa(twofaToken, twofaCode.trim());
      window.location.reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setInfo("If an account exists for that email, we've sent a password reset link. Check your inbox.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!resetToken) {
      setError('Reset link is missing or invalid. Request a new one.');
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      setError(issue);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(resetToken, password);
      clearResetParam();
      setPassword('');
      setConfirmPassword('');
      setInfo('Your password has been reset. You can now sign in with your new password.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  const features = [
    { icon: Briefcase, title: 'Post Job Openings', desc: 'Share referral opportunities at your company' },
    { icon: TrendingUp, title: 'Earn Referral Bonuses', desc: 'Potential awards from your company may await when your referrals get hired' },
    { icon: Users, title: 'Build Your Network', desc: 'Connect with professionals across industries' },
    { icon: MessageSquare, title: 'Direct Messaging', desc: 'Chat privately with potential candidates or friends' },
  ];

  const headings: Record<View, { title: string; subtitle: string }> = {
    login: { title: 'Welcome back', subtitle: 'Sign in to your Referr-All account' },
    register: { title: 'Create your account', subtitle: 'Join thousands of professionals sharing referrals' },
    forgot: { title: 'Reset your password', subtitle: "Enter your email and we'll send you a reset link" },
    reset: { title: 'Choose a new password', subtitle: 'Enter a new password for your account' },
    twofa: { title: 'Two-factor authentication', subtitle: 'Enter the 6-digit code from your authenticator app' },
  };

  const errorBox = error && (
    <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
      {error}
    </div>
  );
  const infoBox = info && (
    <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm rounded-lg px-4 py-3">
      {info}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-gray-900 via-gray-950 to-black relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-cyan-500 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
              <span className="text-white font-black text-lg">RA</span>
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">Referr-All</span>
          </div>
        </div>

        <div className="relative z-10">
          <h1 className="text-4xl font-black text-white leading-tight mb-4">
            Your network is your<br />
            <span className="text-blue-400">greatest asset.</span>
          </h1>
          <p className="text-gray-400 text-lg mb-12">
            Post job openings, connect with talent, and earn referral bonuses — all in one place.
          </p>

          <div className="grid grid-cols-1 gap-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon size={20} className="text-blue-400" />
                </div>
                <div>
                  <div className="text-white font-semibold text-sm">{title}</div>
                  <div className="text-gray-500 text-sm">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-gray-600 text-sm">
          © 2026 Referr-All. All rights reserved.
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-10">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
              <span className="text-white font-black text-lg">RA</span>
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">Referr-All</span>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white mb-1">{headings[view].title}</h2>
              <p className="text-gray-500 text-sm">{headings[view].subtitle}</p>
            </div>

            {(view === 'login' || view === 'register') && (
              <div className="flex rounded-lg bg-gray-800 p-1 mb-6">
                <button
                  type="button"
                  onClick={() => goTo('login')}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                    view === 'login' ? 'bg-blue-500 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => goTo('register')}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                    view === 'register' ? 'bg-blue-500 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            {(view === 'login' || view === 'register') && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {view === 'register' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">I am a...</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setSignupUserType('job_seeker')}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition ${
                            signupUserType === 'job_seeker'
                              ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                              : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          <Users size={18} />
                          <span className="font-medium">Job Seeker</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSignupUserType('employer')}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition ${
                            signupUserType === 'employer'
                              ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                              : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          <Briefcase size={18} />
                          <span className="font-medium">Employer</span>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Full Name</label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        placeholder="Jane Smith"
                        required
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">@</span>
                        <input
                          type="text"
                          value={username}
                          onChange={e => setUsername(e.target.value)}
                          placeholder="janesmith"
                          required
                          autoComplete="username"
                          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-8 pr-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="jane@example.com"
                    required
                    autoComplete="email"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-gray-300">Password</label>
                    {view === 'login' && (
                      <button
                        type="button"
                        onClick={() => goTo('forgot')}
                        className="text-xs text-blue-400 hover:text-blue-300 transition"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>

                {errorBox}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition-colors mt-2"
                >
                  {loading ? 'Please wait...' : view === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              </form>
            )}

            {view === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="jane@example.com"
                    required
                    autoComplete="email"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>

                {errorBox}
                {infoBox}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition-colors mt-2"
                >
                  {loading ? 'Please wait...' : 'Send reset link'}
                </button>

                <button
                  type="button"
                  onClick={() => goTo('login')}
                  className="w-full flex items-center justify-center gap-2 text-gray-400 hover:text-white text-sm transition pt-1"
                >
                  <ArrowLeft size={14} />
                  Back to sign in
                </button>
              </form>
            )}

            {view === 'twofa' && (
              <form onSubmit={handleVerify2fa} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Authentication code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={twofaCode}
                    onChange={e => setTwofaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    required
                    autoFocus
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-center text-lg tracking-[0.4em] placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>

                {errorBox}

                <button
                  type="submit"
                  disabled={loading || twofaCode.length < 6}
                  className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition-colors mt-2"
                >
                  {loading ? 'Verifying...' : 'Verify & sign in'}
                </button>

                <button
                  type="button"
                  onClick={() => { setTwofaToken(''); setTwofaCode(''); goTo('login'); }}
                  className="w-full flex items-center justify-center gap-2 text-gray-400 hover:text-white text-sm transition pt-1"
                >
                  <ArrowLeft size={14} />
                  Back to sign in
                </button>
              </form>
            )}

            {view === 'reset' && (
              info ? (
                <div className="space-y-5">
                  {infoBox}
                  <button
                    type="button"
                    onClick={() => goTo('login')}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg py-3 text-sm transition-colors"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">New Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                    />
                  </div>

                  {errorBox}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition-colors mt-2"
                  >
                    {loading ? 'Please wait...' : 'Reset password'}
                  </button>

                  <button
                    type="button"
                    onClick={() => goTo('login')}
                    className="w-full flex items-center justify-center gap-2 text-gray-400 hover:text-white text-sm transition pt-1"
                  >
                    <ArrowLeft size={14} />
                    Back to sign in
                  </button>
                </form>
              )
            )}
          </div>

          {/* Mobile-only marketing: shown below the form so it's reachable by scrolling */}
          <div className="lg:hidden mt-12 mb-4">
            <h1 className="text-3xl font-black text-white leading-tight mb-3">
              Your network is your <span className="text-blue-400">greatest asset.</span>
            </h1>
            <p className="text-gray-400 text-sm mb-6">
              Post job openings, connect with talent, and earn referral bonuses — all in one place.
            </p>
            <div className="grid grid-cols-1 gap-3">
              {features.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm">{title}</div>
                    <div className="text-gray-500 text-sm">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-gray-600 text-xs mt-8">© 2026 Referr-All. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
