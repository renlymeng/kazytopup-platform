'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { pick, useI18n } from '@/lib/i18n';
import { Game, usd } from '@/lib/types';

type Order = { ref: string; status: string; amountCents: number; expiresAt: string; nickname: string; qrImage: string | null; deeplink: string | null };

export default function Checkout({ game }: { game: Game }) {
  const { lang, t } = useI18n();
  const [playerId, setPlayerId] = useState('');
  const [serverId, setServerId] = useState('');
  const [nick, setNick] = useState<{ nickname: string; token: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'verify' | 'pay'>('');
  const [err, setErr] = useState('');
  const [pkgId, setPkgId] = useState('');
  const [contact, setContact] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState('PENDING');
  const [left, setLeft] = useState(0);
  const idem = useRef(crypto.randomUUID());
  const pkg = game.packages?.find((p) => p.id === pkgId);

  // Any edit to the account fields invalidates the verified nickname.
  const idOk = playerId.length >= game.idMin && playerId.length <= game.idMax && (!game.idNumeric || /^\d+$/.test(playerId));
  const srvOk = !game.needsServerId || (serverId.length > 0 && serverId.length <= game.serverMax);
  useEffect(() => { setNick(null); }, [playerId, serverId]);

  async function verify() {
    setErr(''); setBusy('verify');
    try {
      const r = await api<{ nickname: string; lookupToken: string }>('/lookup', {
        method: 'POST', body: JSON.stringify({ game: game.slug, playerId, ...(game.needsServerId ? { serverId } : {}) }),
      });
      setNick({ nickname: r.nickname, token: r.lookupToken });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  }

  async function pay() {
    if (!nick || !pkg) return;
    setErr(''); setBusy('pay');
    try {
      const o = await api<Order>('/orders', {
        method: 'POST', headers: { 'Idempotency-Key': idem.current },
        body: JSON.stringify({ game: game.slug, packageId: pkg.id, playerId, lookupToken: nick.token,
          ...(game.needsServerId ? { serverId } : {}), ...(contact ? { contact } : {}) }),
      });
      setOrder(o); setStatus(o.status);
      try { sessionStorage.setItem('lastOrder', o.ref); } catch {}
    } catch (e) { setErr((e as Error).message); idem.current = crypto.randomUUID(); } finally { setBusy(''); }
  }

  // Poll status until terminal.
  useEffect(() => {
    if (!order || ['COMPLETED', 'FAILED', 'EXPIRED'].includes(status)) return;
    const id = setInterval(() => api<{ status: string }>(`/orders/${order.ref}`).then((r) => setStatus(r.status)).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [order, status]);

  // Countdown.
  useEffect(() => {
    if (!order) return;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000)));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [order]);

  const name = pick(lang, game.nameEn, game.nameKm);
  const mmss = useMemo(() => `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`, [left]);
  const statusText = (t as any)[`st_${status}`] as string | undefined;

  if (order) {
    const waiting = status === 'PENDING' && left > 0;
    return (
      <section className="box" style={{ marginTop: 20 }} aria-live="polite">
        <h1>{name}</h1>
        <p className="muted" style={{ margin: 0 }}>{order.nickname} · {pick(lang, pkg!.labelEn, pkg!.labelKm)} · {usd(order.amountCents)}</p>
        {waiting && order.qrImage && (<>
          <div className="qr"><img src={order.qrImage} alt="KHQR" /></div>
          <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{t.scan} · {t.expiresIn} {mmss}</p>
          {order.deeplink && <a className="btn primary" href={order.deeplink}>{t.openAba}</a>}
        </>)}
        <p className={`status ${status === 'COMPLETED' ? 'ok' : status === 'FAILED' || status === 'EXPIRED' ? 'err' : ''}`}>
          {status === 'PENDING' && left === 0 ? t.st_EXPIRED : statusText}
        </p>
        <p className="code">{t.orderCode}: {order.ref}</p>
        {(status === 'COMPLETED' || status === 'EXPIRED' || (status === 'PENDING' && left === 0)) && (
          <button className="btn primary" onClick={() => { setOrder(null); setStatus('PENDING'); idem.current = crypto.randomUUID(); }}>{t.newOrder}</button>
        )}
      </section>
    );
  }

  return (
    <section style={{ marginTop: 20 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="card" style={{ width: 88, flex: 'none' }}><div className="art" style={{ backgroundImage: `url(${game.iconUrl})` }} /></div>
        <div><h1 style={{ margin: 0 }}>{name}</h1><p className="muted" style={{ margin: 0 }}>{t.tagline}</p></div>
      </div>

      <div className="box">
        <h2>{t.step1}</h2>
        <label className="field"><span>{pick(lang, game.idLabelEn, game.idLabelKm)}</span>
          <input className="input" inputMode={game.idNumeric ? 'numeric' : 'text'} autoComplete="off" maxLength={game.idMax}
            value={playerId} onChange={(e) => setPlayerId(e.target.value.trim())} placeholder={t.idHint(game.idMin, game.idMax)} />
        </label>
        {game.needsServerId && (
          <label className="field"><span>{t.serverId}</span>
            <input className="input" inputMode="numeric" autoComplete="off" maxLength={game.serverMax} value={serverId} onChange={(e) => setServerId(e.target.value.trim())} />
          </label>)}
        <button className="btn" disabled={!idOk || !srvOk || busy !== ''} onClick={verify}>{busy === 'verify' ? t.verifying : t.verify}</button>
        {nick && <p className="ok" role="status">{t.verified}: <strong>{nick.nickname}</strong></p>}
        {err && <p className="err" role="alert">{err}</p>}
      </div>

      <div className="box" aria-disabled={!nick} style={{ opacity: nick ? 1 : 0.55 }}>
        <h2>{t.step2}</h2>
        <div className="pkgs">
          {game.packages?.map((p) => (
            <button key={p.id} className="pkg" aria-pressed={p.id === pkgId} disabled={!nick} onClick={() => setPkgId(p.id)}>
              <b>{pick(lang, p.labelEn, p.labelKm)}</b><small>{usd(p.priceCents)}</small>
            </button>))}
        </div>
        <label className="field"><span>{t.step3}</span>
          <input className="input" maxLength={64} value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t.contactPh} disabled={!nick} />
        </label>
        <div className="total"><span>{t.total}</span><span>{pkg ? usd(pkg.priceCents) : '—'}</span></div>
        <button className="btn primary" disabled={!nick || !pkg || busy !== ''} onClick={pay}>
          {busy === 'pay' ? t.creating : !nick ? t.verifyFirst : !pkg ? t.selectPkg : t.pay}
        </button>
      </div>
    </section>
  );
}
