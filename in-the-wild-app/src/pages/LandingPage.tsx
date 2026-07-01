import { useState } from 'react';
import { Leaf, Heart, MapPin, Shield, Clock, Sparkles } from 'lucide-react';
import * as api from '../lib/api';

type Props = {
  onTryBeta: () => void;
};

export default function LandingPage({ onTryBeta }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      const res = await api.joinWaitlist({ email, name, city });
      setMsg(res.message);
      setEmail('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="max-w-3xl mx-auto px-4 py-12 md:py-20">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center">
            <Leaf size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">In the Wild</h1>
            <p className="text-emerald-400 text-sm font-medium">Match where you actually are.</p>
          </div>
        </div>

        <p className="text-lg text-stone-300 leading-relaxed mb-10 max-w-2xl">
          Swipe on people you&apos;re interested in — but don&apos;t message until you&apos;re both at the
          same verified event and have opted in to meet. A 6-hour chat window nudges you to say hello
          in person, not text for weeks.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {[
            { icon: Heart, title: 'Swipe interest', desc: 'Like people — no instant DMs' },
            { icon: MapPin, title: 'Meet at events', desc: 'Concerts, festivals, games, church & more' },
            { icon: Sparkles, title: 'Opt in only', desc: '"Open to Meeting" — off by default' },
            { icon: Clock, title: '6-hour chat', desc: 'Coordinate, then meet IRL' },
            { icon: Shield, title: 'Verified & safe', desc: 'ID verification + optional background check' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
              <Icon size={20} className="text-emerald-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">{title}</h3>
              <p className="text-stone-400 text-sm">{desc}</p>
            </div>
          ))}
        </div>

        <div id="how-it-works" className="bg-gradient-to-br from-emerald-950/50 to-stone-900 border border-emerald-800/40 rounded-2xl p-6 md:p-8 mb-10">
          <h2 className="text-xl font-bold mb-2">How it works</h2>
          <ol className="space-y-3 text-stone-300 text-sm md:text-base">
            <li><span className="text-emerald-400 font-bold">1.</span> Swipe right on people you&apos;d like to meet</li>
            <li><span className="text-emerald-400 font-bold">2.</span> Check in when you arrive at a verified event</li>
            <li><span className="text-emerald-400 font-bold">3.</span> Turn on &quot;Open to Meeting Matches&quot; if you&apos;re available</li>
            <li><span className="text-emerald-400 font-bold">4.</span> If you both liked each other and opted in — you&apos;re notified</li>
            <li><span className="text-emerald-400 font-bold">5.</span> Short chat window → introduce yourself in person</li>
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-12">
          <button
            onClick={onTryBeta}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl py-3.5 px-6 transition"
          >
            Try the beta
          </button>
          <a
            href="#how-it-works"
            className="flex-1 text-center border border-stone-700 hover:border-stone-500 text-stone-300 font-medium rounded-xl py-3.5 px-6 transition"
          >
            How it works
          </a>
        </div>

        <form onSubmit={handleWaitlist} className="bg-stone-900 border border-stone-800 rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-1">Join the waitlist</h2>
          <p className="text-stone-400 text-sm mb-4">Get notified when we launch in your city.</p>
          <div className="space-y-3">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4 py-3 text-white placeholder:text-stone-600 focus:outline-none focus:border-emerald-600"
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4 py-3 text-white placeholder:text-stone-600 focus:outline-none focus:border-emerald-600"
              />
              <input
                type="text"
                placeholder="City (optional)"
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4 py-3 text-white placeholder:text-stone-600 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-semibold rounded-xl py-3 transition"
            >
              {loading ? 'Joining…' : 'Notify me'}
            </button>
            {msg && <p className="text-emerald-400 text-sm text-center">{msg}</p>}
          </div>
        </form>
      </div>
    </div>
  );
}
