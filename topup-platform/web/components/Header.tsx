'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Globe, Menu, Moon, Search, Send, Sun, User } from './icons';
import SearchOverlay from './SearchOverlay';
import LoginModal from './LoginModal';
import { api } from '@/lib/api';

const TG = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '#';

export default function Header() {
  const { lang, setLang, t } = useI18n();
  const { theme, toggle } = useTheme();
  const [panel, setPanel] = useState<null | 'search' | 'menu' | 'login'>(null);
  const [member, setMember] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    api<{ member: { name: string } | null }>('/auth/me').then((r) => setMember(r.member?.name ?? null)).catch(() => {});
  }, []);

  return (
    <>
      <div className="strip">
        <span>{t.strip}</span>
        <a className="join" href={TG} target="_blank" rel="noopener noreferrer"><Send />{t.join}</a>
      </div>
      <header className="hdr">
        <div className="hdr-in">
          <Link href="/" className="brand" aria-label={t.home}><span className="brand-mark">T</span><span>TopUp</span></Link>
          <button className="ib" onClick={() => setLang(lang === 'en' ? 'km' : 'en')} aria-label={t.language}>
            <Globe /><span>{lang === 'en' ? 'English' : 'ខ្មែរ'}</span>
          </button>
          <button className="ib" onClick={toggle} aria-label={t.theme}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
          <button className="ib accent" onClick={() => setPanel('search')} aria-label={t.search}><Search /></button>
          <button className="ib" onClick={() => setPanel('login')} aria-label={t.account}><User /></button>
          <button className="ib" onClick={() => setPanel('menu')} aria-label={t.menu}><Menu /></button>
        </div>
      </header>

      {panel === 'search' && <SearchOverlay onClose={() => setPanel(null)} />}
      {panel === 'login' && <LoginModal member={member} onDone={(n) => setMember(n)} onClose={() => setPanel(null)} />}
      {panel === 'menu' && (
        <div className="overlay drawer" onClick={() => setPanel(null)}>
          <nav className="panel nav" onClick={(e) => e.stopPropagation()} aria-label={t.menu}>
            <Link href="/" onClick={() => setPanel(null)}>{t.home}</Link>
            <button onClick={() => setPanel('search')}>{t.allGames}</button>
            <a href={TG} target="_blank" rel="noopener noreferrer">{t.support}</a>
            {member && <button onClick={() => api('/auth/logout', { method: 'POST' }).then(() => { setMember(null); setPanel(null); })}>{t.signOut}</button>}
          </nav>
        </div>
      )}
    </>
  );
}
