'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type Me = { email: string; role: string; mfa: boolean };
type AGame = { id: string; slug: string; nameEn: string; enabled: boolean; packages: unknown[]; updatedAt: string; lookupConfig: unknown; deliveryConfig: unknown };
type Row = { id: string; ref: string; status: string; playerId: string; nickname: string; amountCents: number; createdAt: string; lastError: string | null;
  game: { nameEn: string }; package: { labelEn: string }; payment: { tranId: string; status: string } | null };
type Stats = { byStatus: Record<string, number>; todayRevenueCents: number; todayOrders: number; failed: number };
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function Admin() {
  const r = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<'overview' | 'games' | 'orders'>('overview');
  useEffect(() => { api<Me>('/admin/auth/me').then(setMe).catch(() => r.replace('/admin/login')); }, [r]);
  if (!me) return null;
  const logout = () => api('/admin/auth/logout', { method: 'POST' }).finally(() => r.replace('/admin/login'));
  if (!me.mfa) return <MfaEnrol onDone={() => api<Me>('/admin/auth/me').then(setMe)} />;

  return (
    <div className="adm">
      <div className="row" style={{ alignItems: 'center' }}>
        <h1 style={{ marginRight: 'auto' }}>Control panel</h1>
        <span className="muted">{me.email} · {me.role}</span>
        <button className="ib" onClick={logout}>Sign out</button>
      </div>
      <div className="tabs" role="tablist">
        {(['overview', 'games', 'orders'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'games' && <Games canEdit={me.role !== 'SUPPORT'} />}
      {tab === 'orders' && <Orders canEdit={me.role !== 'SUPPORT'} />}
    </div>
  );
}

function MfaEnrol({ onDone }: { onDone: () => void }) {
  const [qr, setQr] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api<{ qr: string }>('/admin/auth/mfa/setup', { method: 'POST' }).then((r) => setQr(r.qr)).catch((e) => setErr(e.message)); }, []);
  return (
    <div className="box" style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1>Set up two-factor authentication</h1>
      <p className="muted">Scan this code with an authenticator app, then enter the 6-digit code. Admin access stays locked until this is done.</p>
      {qr && <div className="qr"><img src={qr} alt="MFA QR code" /></div>}
      <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Authenticator code" />
      {err && <p className="err">{err}</p>}
      <button className="btn primary" onClick={() => api('/admin/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }).then(onDone).catch((e) => setErr(e.message))}>Enable</button>
    </div>
  );
}

function Overview() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { const l = () => api<Stats>('/admin/stats').then(setS); l(); const id = setInterval(l, 15000); return () => clearInterval(id); }, []);
  if (!s) return null;
  const items: [string, string | number][] = [
    ['Revenue today', usd(s.todayRevenueCents)], ['Delivered today', s.todayOrders], ['Awaiting payment', s.byStatus.PENDING ?? 0],
    ['Delivering', (s.byStatus.PAID ?? 0) + (s.byStatus.DELIVERING ?? 0)], ['Needs attention', s.failed],
  ];
  return <div className="stats">{items.map(([k, v]) => <div className="box stat" key={k}><b>{v}</b><span>{k}</span></div>)}</div>;
}

function Games({ canEdit }: { canEdit: boolean }) {
  const [games, setGames] = useState<AGame[]>([]); const [err, setErr] = useState('');
  const load = useCallback(() => api<AGame[]>('/admin/games').then(setGames), []);
  useEffect(() => { load(); }, [load]);
  async function toggle(g: AGame) {
    setGames((gs) => gs.map((x) => (x.id === g.id ? { ...x, enabled: !g.enabled } : x))); // optimistic
    try { await api(`/admin/games/${g.id}/toggle`, { method: 'PATCH', body: JSON.stringify({ enabled: !g.enabled }) }); }
    catch (e) { setErr((e as Error).message); load(); }
  }
  return (
    <div className="box">
      {err && <p className="err" role="alert">{err}</p>}
      {games.map((g) => (
        <div className="gline" key={g.id}>
          <div className="nm">{g.nameEn}<small>{g.slug} · {g.packages.length} packages · {g.lookupConfig ? 'ID check ✓' : 'no ID check'} · {g.deliveryConfig ? 'delivery ✓' : 'no delivery'}</small></div>
          <span className="muted">{g.enabled ? 'ON' : 'OFF'}</span>
          <button className="switch" role="switch" aria-checked={g.enabled} aria-label={`${g.nameEn} top-up`} disabled={!canEdit} onClick={() => toggle(g)} />
        </div>))}
    </div>
  );
}

function Orders({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) }); if (q) p.set('q', q); if (status) p.set('status', status);
    api<{ rows: Row[]; pages: number }>(`/admin/orders?${p}`).then((r) => { setRows(r.rows); setPages(r.pages); });
  }, [q, status, page]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);
  const retry = (id: string) => api(`/admin/orders/${id}/retry`, { method: 'POST' }).then(() => { setMsg('Queued'); load(); }).catch((e) => setMsg(e.message));
  return (
    <div className="box">
      <div className="row">
        <input className="input" placeholder="Search order code, player ID, nickname, transaction" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" style={{ maxWidth: 170 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>{['PENDING', 'PAID', 'DELIVERING', 'COMPLETED', 'FAILED', 'EXPIRED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
      <div className="scroll-x"><table>
        <thead><tr><th>Time</th><th>Game / package</th><th>Player</th><th>Amount</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((o) => (
          <tr key={o.id}>
            <td>{new Date(o.createdAt).toLocaleString()}</td><td>{o.game.nameEn}<br /><span className="muted">{o.package.labelEn}</span></td>
            <td>{o.playerId}<br /><span className="muted">{o.nickname}</span></td><td>{usd(o.amountCents)}</td>
            <td><span className={`badge ${o.status}`}>{o.status}</span>{o.lastError && <div className="err" style={{ fontSize: 12 }}>{o.lastError}</div>}</td>
            <td>{canEdit && ['FAILED', 'PAID', 'DELIVERING', 'PENDING', 'EXPIRED'].includes(o.status) && <button className="ib" onClick={() => retry(o.id)}>Re-check</button>}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <button className="ib" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button><span className="muted">{page} / {pages || 1}</span>
        <button className="ib" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
