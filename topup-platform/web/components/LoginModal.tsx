'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

declare global { interface Window { google?: any; onTelegramAuth?: (u: Record<string, string>) => void } }
const GID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const TGBOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

export default function LoginModal({ member, onDone, onClose }: { member: string | null; onDone: (n: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const gRef = useRef<HTMLDivElement>(null);
  const tRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (member) return;
    const done = (r: { name: string }) => { onDone(r.name); onClose(); };
    const fail = (e: Error) => setErr(e.message);
    if (GID) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => {
        window.google?.accounts.id.initialize({ client_id: GID, callback: (r: { credential: string }) =>
          api<{ name: string }>('/auth/google', { method: 'POST', body: JSON.stringify({ credential: r.credential }) }).then(done, fail) });
        if (gRef.current) window.google?.accounts.id.renderButton(gRef.current, { theme: 'outline', size: 'large', shape: 'pill', width: 280 });
        window.google?.accounts.id.prompt(); // One Tap
      };
      document.head.appendChild(s);
    }
    if (TGBOT && tRef.current) {
      window.onTelegramAuth = (u) => api<{ name: string }>('/auth/telegram', { method: 'POST', body: JSON.stringify(u) }).then(done, fail);
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-widget.js?22'; s.async = true;
      s.setAttribute('data-telegram-login', TGBOT); s.setAttribute('data-size', 'large');
      s.setAttribute('data-radius', '20'); s.setAttribute('data-onauth', 'onTelegramAuth(user)'); s.setAttribute('data-request-access', 'write');
      tRef.current.appendChild(s);
    }
  }, [member, onDone, onClose]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t.signIn}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>{member ?? t.signIn}</h2>
        <p className="muted">{t.signInSub}</p>
        {!member && (<>
          <div ref={gRef} style={{ marginTop: 14 }} />
          <div ref={tRef} style={{ marginTop: 14 }} />
          {!GID && !TGBOT && <p className="muted">—</p>}
        </>)}
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </div>
  );
}
