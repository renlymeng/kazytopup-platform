'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export default function AdminLogin() {
  const r = useRouter();
  const [f, setF] = useState({ email: '', password: '', totp: '' });
  const [mfa, setMfa] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: f.email, password: f.password, ...(f.totp ? { totp: f.totp } : {}) }) });
      r.replace('/admin');
    } catch (x) {
      if (x instanceof ApiError && x.body?.mfaRequired) setMfa(true); else setErr((x as Error).message);
    } finally { setBusy(false); }
  }
  return (
    <form className="box" style={{ marginTop: 60 }} onSubmit={submit}>
      <h1>Admin sign in</h1>
      <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      {mfa && <label className="field"><span>Authenticator code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus required value={f.totp} onChange={(e) => setF({ ...f, totp: e.target.value })} /></label>}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy}>Sign in</button>
    </form>
  );
}
