import { useState } from 'react';
import { Shield, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../lib/api';

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [bio, setBio] = useState(profile?.bio || '');
  const [city, setCity] = useState(profile?.city || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [interests, setInterests] = useState((profile?.interests || []).join(', '));
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!profile) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    try {
      await api.updateProfile({
        bio,
        city,
        avatar_url: avatarUrl,
        interests: interests.split(',').map(s => s.trim()).filter(Boolean),
      });
      await refreshProfile();
      setSaved(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">Profile</h1>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-20 h-20 rounded-2xl bg-stone-800 overflow-hidden flex items-center justify-center">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl font-bold text-stone-600">
              {(profile.display_name || '?').charAt(0)}
            </span>
          )}
        </div>
        <div>
          <p className="text-white font-bold text-lg">{profile.display_name}</p>
          <p className="text-stone-500 text-sm">@{profile.username}</p>
          <div className="flex gap-2 mt-2">
            {profile.id_verified && (
              <span className="text-xs bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle size={12} /> ID verified
              </span>
            )}
            {profile.background_verified && (
              <span className="text-xs bg-stone-800 text-stone-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Shield size={12} /> Background check
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6">
        <p className="text-stone-400 text-sm mb-2">Trust & safety (coming soon)</p>
        <p className="text-stone-500 text-xs">
          ID verification via Stripe Identity and optional background checks will be required before
          venue chat unlocks in production.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-stone-400 text-xs block mb-1">Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">City</label>
          <input
            value={city}
            onChange={e => setCity(e.target.value)}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">Photo URL</label>
          <input
            value={avatarUrl}
            onChange={e => setAvatarUrl(e.target.value)}
            placeholder="https://…"
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">Interests (comma-separated)</label>
          <input
            value={interests}
            onChange={e => setInterests(e.target.value)}
            placeholder="hiking, live music, coffee"
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition"
        >
          {loading ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <p className="text-emerald-400 text-sm text-center">Saved!</p>}
      </form>
    </div>
  );
}
