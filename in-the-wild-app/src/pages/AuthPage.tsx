import { useState } from 'react';
import { Leaf } from 'lucide-react';
import * as api from '../lib/api';
import { GENDER_OPTIONS, LOOKING_FOR_OPTIONS } from '../lib/preferences';

type Props = {
  onBack: () => void;
  onSuccess: () => void;
};

export default function AuthPage({ onBack, onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.register({
        email,
        password,
        username,
        display_name: displayName || username,
        birth_year: parseInt(birthYear, 10),
        gender,
        looking_for: lookingFor,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600';
  const labelClass = 'block text-sm font-medium text-stone-300 mb-1.5';

  return (
    <div className="min-h-screen bg-stone-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <button type="button" onClick={onBack} className="text-stone-500 hover:text-stone-300 text-sm mb-6">
          ← Back
        </button>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
            <Leaf size={20} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {mode === 'register' ? 'Create account' : 'Welcome back'}
          </h1>
        </div>

        <div className="flex gap-2 mb-6" role="tablist">
          {(['register', 'login'] as const).map(m => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError('');
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                mode === m ? 'bg-emerald-600 text-white' : 'bg-stone-900 text-stone-400'
              }`}
            >
              {m === 'register' ? 'Sign up' : 'Sign in'}
            </button>
          ))}
        </div>

        {mode === 'register' ? (
          <form
            key="register"
            onSubmit={handleRegister}
            method="post"
            autoComplete="on"
            className="space-y-4"
          >
            <div>
              <label htmlFor="itw-username" className={labelClass}>Username</label>
              <input
                id="itw-username"
                name="username"
                type="text"
                required
                autoComplete="username"
                placeholder="janesmith"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="itw-display-name" className={labelClass}>Display name</label>
              <input
                id="itw-display-name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Jane Smith"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="itw-birth-year" className={labelClass}>Birth year</label>
              <select
                id="itw-birth-year"
                name="bday-year"
                required
                autoComplete="bday-year"
                value={birthYear}
                onChange={e => setBirthYear(e.target.value)}
                className={inputClass}
              >
                <option value="">Select year — must be 18+</option>
                {Array.from({ length: 82 }, (_, i) => new Date().getFullYear() - 18 - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="itw-gender" className={labelClass}>I am</label>
              <select
                id="itw-gender"
                name="gender"
                required
                value={gender}
                onChange={e => setGender(e.target.value)}
                className={inputClass}
              >
                <option value="">Select…</option>
                {GENDER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="itw-looking-for" className={labelClass}>Interested in</label>
              <select
                id="itw-looking-for"
                name="looking_for"
                required
                value={lookingFor}
                onChange={e => setLookingFor(e.target.value)}
                className={inputClass}
              >
                <option value="">Select…</option>
                {LOOKING_FOR_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="itw-reg-email" className={labelClass}>Email</label>
              <input
                id="itw-reg-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="jane@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="itw-reg-password" className={labelClass}>Password</label>
              <input
                id="itw-reg-password"
                name="new-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 transition"
            >
              {loading ? 'Please wait…' : 'Create account'}
            </button>
          </form>
        ) : (
          <form
            key="login"
            onSubmit={handleLogin}
            method="post"
            autoComplete="on"
            className="space-y-4"
          >
            <div>
              <label htmlFor="itw-login-email" className={labelClass}>Email</label>
              <input
                id="itw-login-email"
                name="email"
                type="email"
                required
                autoComplete="username email"
                placeholder="jane@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="itw-login-password" className={labelClass}>Password</label>
              <input
                id="itw-login-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 transition"
            >
              {loading ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
