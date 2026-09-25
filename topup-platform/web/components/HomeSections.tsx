'use client';
import { useI18n } from '@/lib/i18n';
import type { Game } from '@/lib/types';
import { Arrow, Flame, Send } from './icons';
import GameCard from './GameCard';

const TG = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '#';

export function TelegramCard() {
  const { t } = useI18n();
  return (
    <section className="tg" aria-label={t.joinTitle}>
      <div className="tg-row">
        <div className="tg-ic"><Send /></div>
        <div><b>{t.joinTitle}</b><small>{t.joinSub}</small></div>
      </div>
      <a className="btn" href={TG} target="_blank" rel="noopener noreferrer">{t.joinBtn}</a>
    </section>
  );
}

export function Featured({ games }: { games: Game[] }) {
  const { t } = useI18n();
  return (
    <section>
      <div className="chips">
        <span className="chip hot"><Flame /> {t.trending}</span>
        <span className="chip">{t.hotPicks(games.filter((g) => g.hot).length)}</span>
      </div>
      <h1>{t.featured}</h1>
      <p className="muted" style={{ margin: 0 }}>{t.tagline}</p>
      <a className="sec-link" href="#all">{t.allGames} <Arrow /></a>
      {games.length === 0 ? <p className="muted">{t.noGames}</p> : (
        <div className="grid" id="all">{games.map((g) => <GameCard key={g.id} g={g} />)}</div>
      )}
    </section>
  );
}
