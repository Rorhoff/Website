import { useRef, useState } from 'react';
import { Camera, Shield, CheckCircle, Settings } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../lib/api';
import { compressImageForUpload } from '../lib/resizeImage';
import { GENDER_OPTIONS, LOOKING_FOR_OPTIONS } from '../lib/preferences';

type Props = {
  onOpenAdmin?: () => void;
};

export default function ProfilePage({ onOpenAdmin }: Props) {
  const { profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState(profile?.bio || '');
  const [city, setCity] = useState(profile?.city || '');
  const [gender, setGender] = useState(profile?.gender || '');
  const [lookingFor, setLookingFor] = useState(profile?.looking_for || '');
  const [interests, setInterests] = useState((profile?.interests || []).join(', '));
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');

  if (!profile) return null;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImageForUpload(file);
      await api.uploadAvatar(compressed);
      await refreshProfile();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleVerify() {
    try {
      const res = await api.startIdVerification();
      setVerifyMsg(res.message);
    } catch (err) {
      setVerifyMsg(err instanceof Error ? err.message : 'Could not start verification');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    try {
      await api.updateProfile({
        bio,
        city,
        gender,
        looking_for: lookingFor,
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Profile</h1>
        {profile.is_admin && onOpenAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium"
          >
            <Settings size={16} /> Admin
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative w-20 h-20 rounded-2xl bg-stone-800 overflow-hidden flex items-center justify-center group"
        >
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl font-bold text-stone-600">
              {(profile.display_name || '?').charAt(0)}
            </span>
          )}
          <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
            <Camera size={20} className="text-white" />
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        <div>
          <p className="text-white font-bold text-lg">{profile.display_name}</p>
          <p className="text-stone-500 text-sm">@{profile.username}{profile.age ? ` · ${profile.age}` : ''}</p>
          <p className="text-stone-600 text-xs mt-1">{uploading ? 'Uploading…' : 'Tap photo to upload'}</p>
          <div className="flex gap-2 mt-2 flex-wrap">
            {profile.id_verified ? (
              <span className="text-xs bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle size={12} /> ID verified
              </span>
            ) : (
              <span className="text-xs bg-amber-950 text-amber-400 px-2 py-0.5 rounded-full">ID required to chat</span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white text-sm font-medium">Identity verification</p>
            <p className="text-stone-500 text-xs mt-1">
              Required before venue chat. Stripe Identity coming soon — admins can verify manually during beta.
            </p>
            {!profile.id_verified && (
              <button
                type="button"
                onClick={handleVerify}
                className="mt-3 text-sm text-emerald-400 font-medium hover:text-emerald-300"
              >
                Start verification →
              </button>
            )}
            {verifyMsg && <p className="text-stone-400 text-xs mt-2">{verifyMsg}</p>}
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-stone-400 text-xs block mb-1">I am</label>
          <select
            value={gender}
            onChange={e => setGender(e.target.value)}
            required
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          >
            <option value="">Select…</option>
            {GENDER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-stone-400 text-xs block mb-1">Interested in</label>
          <select
            value={lookingFor}
            onChange={e => setLookingFor(e.target.value)}
            required
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-600"
          >
            <option value="">Select…</option>
            {LOOKING_FOR_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
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
