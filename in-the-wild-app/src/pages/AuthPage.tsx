import { useState } from 'react';
import { Leaf } from 'lucide-react';
import * as api from '../lib/api';

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        await api.register({ email, password, username, display_name: displayName || username });
      } else {
        await api.login(email, password);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="text-stone-500 hover:text-stone-300 text-sm mb-6">
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

        <div className="flex gap-2 mb-6">
          {(['register', 'login'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                mode === m ? 'bg-emerald-600 text-white' : 'bg-stone-900 text-stone-400'
              }`}
            >
              {m === 'register' ? 'Sign up' : 'Sign in'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <input
                required
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
              />
              <input
                placeholder="Display name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
              />
            </>
          )}
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
          <input
            required
            type="password"
            minLength={8}
            placeholder="Password (8+ chars)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 transition"
          >
            {loading ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
