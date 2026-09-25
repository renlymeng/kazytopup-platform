'use client';
import Link from 'next/link';
import { pick, useI18n } from '@/lib/i18n';
import type { Game } from '@/lib/types';
import { Bolt, Flame } from './icons';

export default function GameCard({ g, onNavigate }: { g: Game; onNavigate?: () => void }) {
  const { lang, t } = useI18n();
  const name = pick(lang, g.nameEn, g.nameKm);
  return (
    <Link href={`/games/${g.slug}`} className="card" onClick={onNavigate}>
      <div className="tags">
        {g.hot && <span className="tag hot"><Flame /> {t.hot}</span>}
        {g.instant && <span className="tag inst"><Bolt /> {t.instant}</span>}
      </div>
      <div className="art" style={{ backgroundImage: `url(${g.iconUrl})` }} role="img" aria-label={name}>
        <span aria-hidden style={{ opacity: 0.25 }}>{g.nameEn.slice(0, 1)}</span>
      </div>
      <div className="nm">{name}</div>
    </Link>
  );
}
