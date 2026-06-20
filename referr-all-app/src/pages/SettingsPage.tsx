import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Ban, Bell, CreditCard, Eye, Fingerprint, KeyRound, LogOut,
  Mail, Monitor, Phone, Shield, ShieldCheck, Smartphone, Trash2, UserCheck,
} from 'lucide-react';
import * as api from '../lib/api';
import type { AccountSession, AccountSettings, BlockEntry, Profile, PurchaseRecord } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  onBack: () => void;
  onViewProfile: (userId: string) => void;
  onOpenAdmin?: () => void;
};

export default function SettingsPage({ onBack, onViewProfile, onOpenAdmin }: Props) {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [blockedList, setBlockedList] = useState<BlockEntry[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [blocks, sess, buys] = await Promise.all([
      api.listBlocks().catch(() => [] as BlockEntry[]),
      api.listSessions().catch(() => [] as AccountSession[]),
      api.listPurchases().catch(() => [] as PurchaseRecord[]),
    ]);
    setBlockedList(blocks);
    setSessions(sess);
    setPurchases(buys);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function unblockUser(blockedId: string) {
    setActionLoading(blockedId);
    await api.deleteBlock(blockedId);
    setBlockedList(list => list.filter(b => b.blocked_id !== blockedId));
    setActionLoading(null);
  }

  return (
    <div className="max-w-3xl mx-auto pb-20 md:pb-0">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition flex-shrink-0"
          title="Back to profile"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your account, privacy, and security</p>
        </div>
      </div>

      {onOpenAdmin && (
        <section className="mb-6">
          <button
            type="button"
            onClick={onOpenAdmin}
            className="w-full flex items-center justify-between gap-3 bg-gray-900 border border-gray-800 hover:border-blue-500/40 rounded-2xl px-5 py-4 transition text-left group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <Shield size={18} className="text-blue-400" />
              </div>
              <div className="min-w-0">
                <div className="text-white font-medium text-sm">Administration</div>
                <div className="text-gray-500 text-xs mt-0.5">Manage users, posts, and reports</div>
              </div>
            </div>
            <span className="text-gray-600 group-hover:text-gray-400 text-sm">→</span>
          </button>
        </section>
      )}

      <EmailSection profile={profile} onChanged={refreshProfile} />
      <PhoneSection profile={profile} onChanged={refreshProfile} />
      <PasswordSection />
      <TwoFactorSection profile={profile} onChanged={refreshProfile} />
      <SessionsSection sessions={sessions} loading={loading} onReload={loadAll} />
      <PasskeysSection />
      <PreferencesSection profile={profile} />
      <PurchaseHistorySection purchases={purchases} loading={loading} />

      <DangerZone
        onDeactivated={signOut}
        onDeleted={signOut}
        blockedList={blockedList}
        blockedLoading={loading}
        unblockingId={actionLoading}
        onViewProfile={onViewProfile}
        onUnblock={unblockUser}
      />
    </div>
  );
}

/* ---------- Email ---------- */

function EmailSection({ profile, onChanged }: { profile: Profile | null; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.changeEmail(password, newEmail.trim());
      await onChanged();
      setOpen(false);
      setPassword('');
      setNewEmail('');
      setMsg({ kind: 'ok', text: res.verificationSent ? 'Email updated. Check your new inbox to verify it.' : 'Email updated.' });
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={Mail} title="Email Address" desc="Used for sign-in, notifications, and account recovery.">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-white text-sm font-medium truncate">{profile?.email || '—'}</div>
            <div className="text-xs mt-0.5">
              {profile?.email_verified
                ? <span className="text-emerald-400">Verified</span>
                : <span className="text-amber-400">Not verified</span>}
            </div>
          </div>
          <button onClick={() => { setOpen(o => !o); setMsg(null); }} className={secondaryBtn}>{open ? 'Cancel' : 'Change'}</button>
        </div>
        <MsgBox msg={msg} />
        {open && (
          <form onSubmit={submit} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
            <Input type="email" value={newEmail} onChange={setNewEmail} placeholder="new@email.com" label="New email" required />
            <Input type="password" value={password} onChange={setPassword} placeholder="Current password" label="Confirm with your password" required />
            <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Saving...' : 'Update email'}</button>
          </form>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Phone ---------- */

function PhoneSection({ profile, onChanged }: { profile: Profile | null; onChanged: () => Promise<void> }) {
  const [phone, setPhone] = useState(profile?.phone || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => { setPhone(profile?.phone || ''); }, [profile?.phone]);

  async function save(value: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.setPhone(value);
      await onChanged();
      setMsg({ kind: 'ok', text: value ? 'Phone number saved.' : 'Phone number removed.' });
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={Phone} title="Phone Number" desc="A recovery contact for your account. (SMS verification coming soon.)">
      <Card>
        <form onSubmit={e => { e.preventDefault(); save(phone.trim()); }} className="flex items-center gap-3">
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+1 (555) 555-5555"
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
          />
          <button type="submit" disabled={busy} className={primaryBtn}>{busy ? '...' : 'Save'}</button>
          {profile?.phone && (
            <button type="button" onClick={() => { setPhone(''); save(''); }} disabled={busy} className={dangerBtn}>Remove</button>
          )}
        </form>
        <MsgBox msg={msg} />
      </Card>
    </Section>
  );
}

/* ---------- Password ---------- */

function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) { setMsg({ kind: 'err', text: 'New passwords do not match.' }); return; }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setOpen(false);
      setCurrent(''); setNext(''); setConfirm('');
      setMsg({ kind: 'ok', text: 'Password changed. Other devices were signed out.' });
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={KeyRound} title="Password" desc="Change the password you use to sign in.">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="text-gray-400 text-sm">••••••••</div>
          <button onClick={() => { setOpen(o => !o); setMsg(null); }} className={secondaryBtn}>{open ? 'Cancel' : 'Change password'}</button>
        </div>
        <MsgBox msg={msg} />
        {open && (
          <form onSubmit={submit} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
            <Input type="password" value={current} onChange={setCurrent} label="Current password" required />
            <Input type="password" value={next} onChange={setNext} label="New password" required />
            <Input type="password" value={confirm} onChange={setConfirm} label="Confirm new password" required />
            <p className="text-gray-600 text-xs">At least 8 characters, including a number and a special character.</p>
            <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Saving...' : 'Update password'}</button>
          </form>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Two-factor ---------- */

function TwoFactorSection({ profile, onChanged }: { profile: Profile | null; onChanged: () => Promise<void> }) {
  const enabled = !!profile?.totp_enabled;
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function startSetup() {
    setBusy(true); setMsg(null);
    try {
      const s = await api.twoFactorSetup();
      setSetup({ secret: s.secret, qrDataUrl: s.qrDataUrl });
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setBusy(true); setMsg(null);
    try {
      await api.twoFactorEnable(setup.secret, code.trim());
      setSetup(null); setCode('');
      await onChanged();
      setMsg({ kind: 'ok', text: 'Two-factor authentication is on.' });
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api.twoFactorDisable(password);
      setDisabling(false); setPassword('');
      await onChanged();
      setMsg({ kind: 'ok', text: 'Two-factor authentication is off.' });
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={ShieldCheck} title="Two-Factor Authentication" desc="Require a one-time code from an authenticator app when you sign in.">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-white text-sm font-medium">Authenticator app (TOTP)</div>
            <div className="text-xs mt-0.5">{enabled ? <span className="text-emerald-400">Enabled</span> : <span className="text-gray-500">Disabled</span>}</div>
          </div>
          {!enabled && !setup && <button onClick={startSetup} disabled={busy} className={primaryBtn}>{busy ? '...' : 'Enable'}</button>}
          {enabled && !disabling && <button onClick={() => { setDisabling(true); setMsg(null); }} className={dangerBtn}>Disable</button>}
        </div>

        <MsgBox msg={msg} />

        {setup && (
          <form onSubmit={enable} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
            <p className="text-gray-400 text-sm">Scan this QR code with Google Authenticator, Authy, or 1Password, then enter the 6-digit code to confirm.</p>
            {setup.qrDataUrl && <img src={setup.qrDataUrl} alt="2FA QR code" className="w-40 h-40 rounded-lg bg-white p-2" />}
            <div className="text-xs text-gray-500">Can't scan? Enter this key manually:<br /><code className="text-gray-300 break-all">{setup.secret}</code></div>
            <Input type="text" value={code} onChange={v => setCode(v.replace(/\D/g, '').slice(0, 6))} label="6-digit code" placeholder="123456" required />
            <div className="flex gap-2">
              <button type="submit" disabled={busy || code.length < 6} className={primaryBtn}>{busy ? 'Verifying...' : 'Confirm & enable'}</button>
              <button type="button" onClick={() => { setSetup(null); setCode(''); }} className={secondaryBtn}>Cancel</button>
            </div>
          </form>
        )}

        {disabling && (
          <form onSubmit={disable} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
            <Input type="password" value={password} onChange={setPassword} label="Confirm with your password" required />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={dangerBtn}>{busy ? '...' : 'Turn off 2FA'}</button>
              <button type="button" onClick={() => { setDisabling(false); setPassword(''); }} className={secondaryBtn}>Cancel</button>
            </div>
          </form>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Sessions ---------- */

function SessionsSection({ sessions, loading, onReload }: { sessions: AccountSession[]; loading: boolean; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    try { await api.revokeSession(id); await onReload(); } finally { setBusy(null); }
  }
  async function revokeOthers() {
    setBusy('others');
    try { await api.revokeOtherSessions(); await onReload(); } finally { setBusy(null); }
  }

  return (
    <Section icon={Monitor} title="Where You're Signed In" desc="Active sessions on your account. Sign out the ones you don't recognize.">
      <Card>
        {loading ? (
          <div className="text-gray-500 text-sm py-2">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="text-gray-500 text-sm py-2">No active sessions.</div>
        ) : (
          <div className="space-y-3">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Smartphone size={18} className="text-gray-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-white text-sm truncate">
                      {uaLabel(s.user_agent)}
                      {s.current && <span className="ml-2 text-xs text-emerald-400">This device</span>}
                    </div>
                    <div className="text-gray-600 text-xs truncate">
                      {s.ip || 'unknown IP'} · last active {timeAgo(s.last_seen_at || s.created_at)}
                    </div>
                  </div>
                </div>
                {!s.current && (
                  <button onClick={() => revoke(s.id)} disabled={busy === s.id} className={secondaryBtn}>
                    {busy === s.id ? '...' : 'Sign out'}
                  </button>
                )}
              </div>
            ))}
            {sessions.some(s => !s.current) && (
              <button onClick={revokeOthers} disabled={busy === 'others'} className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition pt-1">
                <LogOut size={14} />
                {busy === 'others' ? 'Signing out…' : 'Sign out of all other devices'}
              </button>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Passkeys ---------- */

function PasskeysSection() {
  return (
    <Section icon={Fingerprint} title="Passkeys" desc="Sign in with Face ID, Touch ID, or a security key instead of a password.">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="text-gray-400 text-sm">No passkeys yet.</div>
          <span className="text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">Coming soon</span>
        </div>
      </Card>
    </Section>
  );
}

/* ---------- Preferences ---------- */

const NOTIFY_TOGGLES: { key: keyof AccountSettings; label: string; desc: string }[] = [
  { key: 'email_notifications', label: 'Email notifications', desc: 'Master switch for all account emails.' },
  { key: 'connection_request_emails', label: 'Connection requests', desc: 'Email me when someone wants to connect.' },
  { key: 'message_emails', label: 'New messages', desc: 'Email me when I receive a new message.' },
  { key: 'marketing_emails', label: 'Product updates', desc: 'Occasional news and tips from Referr-All.' },
];
const VISIBILITY_TOGGLES: { key: keyof AccountSettings; label: string; desc: string }[] = [
  { key: 'profile_discoverable', label: 'Discoverable profile', desc: 'Let others find me in network search and discovery.' },
  { key: 'show_online_status', label: 'Show activity status', desc: 'Let connections see when I was last active.' },
];

function PreferencesSection({ profile }: { profile: Profile | null }) {
  const [settings, setSettings] = useState<AccountSettings>(profile?.settings || {});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setSettings(profile?.settings || {}); }, [profile?.settings]);

  const val = (key: keyof AccountSettings) => settings[key] !== false; // default ON

  async function toggle(key: keyof AccountSettings) {
    const nextVal = !val(key);
    const optimistic = { ...settings, [key]: nextVal };
    setSettings(optimistic);
    setBusy(key);
    try {
      const res = await api.updateAccountSettings({ [key]: nextVal });
      setSettings(res.settings);
    } catch {
      setSettings(settings); // revert
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Section icon={Bell} title="Notifications" desc="Choose which emails Referr-All can send you.">
        <Card>
          <div className="divide-y divide-gray-800">
            {NOTIFY_TOGGLES.map(t => (
              <ToggleRow key={t.key} label={t.label} desc={t.desc} on={val(t.key)} busy={busy === t.key} onToggle={() => toggle(t.key)} />
            ))}
          </div>
        </Card>
      </Section>

      <Section icon={Eye} title="Visibility" desc="Control how you appear to other members.">
        <Card>
          <div className="divide-y divide-gray-800">
            {VISIBILITY_TOGGLES.map(t => (
              <ToggleRow key={t.key} label={t.label} desc={t.desc} on={val(t.key)} busy={busy === t.key} onToggle={() => toggle(t.key)} />
            ))}
          </div>
        </Card>
      </Section>
    </>
  );
}

/* ---------- Purchase history ---------- */

function PurchaseHistorySection({ purchases, loading }: { purchases: PurchaseRecord[]; loading: boolean }) {
  return (
    <Section icon={CreditCard} title="Purchase History" desc="Your Featured seeker-post payments.">
      <Card>
        {loading ? (
          <div className="text-gray-500 text-sm py-2">Loading…</div>
        ) : purchases.length === 0 ? (
          <div className="text-gray-500 text-sm py-2">No purchases yet.</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {purchases.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-white text-sm truncate">{p.description}</div>
                  <div className="text-gray-600 text-xs">{fmtDate(p.created_at)}{p.refunded_at && ` · refunded ${fmtMoney(p.refund_cents || 0)}`}</div>
                </div>
                <div className={`text-sm font-medium flex-shrink-0 ${p.refunded_at ? 'text-gray-500 line-through' : 'text-white'}`}>{fmtMoney(p.amount_cents)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Danger zone ---------- */

function DangerZone({
  onDeactivated, onDeleted, blockedList, blockedLoading, unblockingId, onViewProfile, onUnblock,
}: {
  onDeactivated: () => Promise<void>;
  onDeleted: () => Promise<void>;
  blockedList: BlockEntry[];
  blockedLoading: boolean;
  unblockingId: string | null;
  onViewProfile: (userId: string) => void;
  onUnblock: (blockedId: string) => void;
}) {
  const [mode, setMode] = useState<'none' | 'deactivate' | 'delete'>('none');
  const [showBlocked, setShowBlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function deactivate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api.deactivateAccount(password);
      await onDeactivated();
      window.location.reload();
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
      setBusy(false);
    }
  }

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText !== 'DELETE') { setMsg({ kind: 'err', text: 'Type DELETE to confirm.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.deleteAccount(password);
      await onDeleted();
      window.location.reload();
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err) });
      setBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2.5 mb-1">
        <Trash2 size={18} className="text-red-400" />
        <h2 className="text-lg font-bold text-white">Account Management</h2>
      </div>
      <p className="text-gray-500 text-sm mb-4">Temporarily hibernate or permanently delete your account.</p>

      <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800">
        {/* Blocked users */}
        <div className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-white text-sm font-medium">Blocked users</div>
              <div className="text-gray-500 text-xs mt-0.5">People you block won't appear in search or discovery, and can't message you.</div>
            </div>
            <button onClick={() => setShowBlocked(s => !s)} className={secondaryBtn}>
              {showBlocked ? 'Hide' : `Manage${blockedList.length ? ` (${blockedList.length})` : ''}`}
            </button>
          </div>
          {showBlocked && (
            <div className="mt-4 border-t border-gray-800 pt-4">
              {blockedLoading ? (
                <div className="text-gray-500 text-sm">Loading…</div>
              ) : blockedList.length === 0 ? (
                <p className="text-gray-500 text-sm">You haven't blocked anyone.</p>
              ) : (
                <div className="space-y-2">
                  {blockedList.map(entry => {
                    const person = entry.profile;
                    if (!person) return null;
                    return (
                      <div key={entry.id} className="bg-gray-800/60 rounded-lg p-3 flex items-center justify-between gap-3">
                        <button onClick={() => onViewProfile(person.id)} className="flex items-center gap-3 group min-w-0">
                          <Avatar profile={person} />
                          <div className="min-w-0 text-left">
                            <div className="text-white font-semibold text-sm group-hover:text-blue-400 transition truncate">{person.full_name}</div>
                            <div className="text-gray-500 text-xs truncate">
                              {person.role && person.company ? `${person.role} at ${person.company}` : `@${person.username}`}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() => onUnblock(entry.blocked_id)}
                          disabled={unblockingId === entry.blocked_id}
                          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-lg px-3 py-2 text-sm transition disabled:opacity-50 flex-shrink-0"
                        >
                          <UserCheck size={14} />
                          {unblockingId === entry.blocked_id ? 'Unblocking...' : 'Unblock'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hibernate */}
        <div className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-white text-sm font-medium">Hibernate account</div>
              <div className="text-gray-500 text-xs mt-0.5">Hide your profile and posts. Signing back in reactivates everything.</div>
            </div>
            {mode !== 'deactivate' && <button onClick={() => { setMode('deactivate'); setMsg(null); }} className={secondaryBtn}>Hibernate</button>}
          </div>
          {mode === 'deactivate' && (
            <form onSubmit={deactivate} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
              <Input type="password" value={password} onChange={setPassword} label="Confirm with your password" required />
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={dangerBtn}>{busy ? '...' : 'Hibernate my account'}</button>
                <button type="button" onClick={() => { setMode('none'); setPassword(''); }} className={secondaryBtn}>Cancel</button>
              </div>
            </form>
          )}
        </div>

        {/* Delete */}
        <div className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-red-400 text-sm font-medium">Close & delete account</div>
              <div className="text-gray-500 text-xs mt-0.5">Permanently removes your profile, posts, messages, and connections. This cannot be undone.</div>
            </div>
            {mode !== 'delete' && <button onClick={() => { setMode('delete'); setMsg(null); }} className={dangerBtn}>Delete</button>}
          </div>
          {mode === 'delete' && (
            <form onSubmit={remove} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
              <Input type="password" value={password} onChange={setPassword} label="Confirm with your password" required />
              <Input type="text" value={confirmText} onChange={setConfirmText} label="Type DELETE to confirm" placeholder="DELETE" required />
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={dangerBtn}>{busy ? 'Deleting...' : 'Permanently delete'}</button>
                <button type="button" onClick={() => { setMode('none'); setPassword(''); setConfirmText(''); }} className={secondaryBtn}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
      <MsgBox msg={msg} />
    </section>
  );
}

/* ---------- Shared bits ---------- */

type Msg = { kind: 'ok' | 'err'; text: string } | null;

const primaryBtn = 'bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm transition disabled:opacity-50 flex-shrink-0';
const secondaryBtn = 'bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium rounded-lg px-4 py-2 text-sm transition disabled:opacity-50 flex-shrink-0';
const dangerBtn = 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-medium rounded-lg px-4 py-2 text-sm transition disabled:opacity-50 flex-shrink-0';

function errText(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function Section({ icon: Icon, title, desc, children }: { icon: typeof Ban; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2.5 mb-1">
        <Icon size={18} className="text-blue-400" />
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      <p className="text-gray-500 text-sm mb-4">{desc}</p>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">{children}</div>;
}

function Input({ type, value, onChange, label, placeholder, required }: {
  type: string; value: string; onChange: (v: string) => void; label: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
      />
    </div>
  );
}

function ToggleRow({ label, desc, on, busy, onToggle }: { label: string; desc: string; on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-white text-sm font-medium">{label}</div>
        <div className="text-gray-500 text-xs mt-0.5">{desc}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={on}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${on ? 'bg-blue-500' : 'bg-gray-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function MsgBox({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
      msg.kind === 'ok'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        : 'bg-red-500/10 border-red-500/30 text-red-400'
    }`}>{msg.text}</div>
  );
}

function Avatar({ profile }: { profile: Profile }) {
  return (
    <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center overflow-hidden flex-shrink-0">
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-blue-400 font-semibold text-base">{profile?.full_name?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </div>
  );
}

function uaLabel(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function timeAgo(date: string | null): string {
  if (!date) return 'unknown';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return date; }
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
