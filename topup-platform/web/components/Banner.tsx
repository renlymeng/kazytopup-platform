'use client';
import { useEffect, useState } from 'react';
import { pick, useI18n } from '@/lib/i18n';
import type { Game } from '@/lib/types';

export default function Banner({ games }: { games: Game[] }) {
  const { lang } = useI18n();
  const [i, setI] = useState(0);
  const slides = games.filter((g) => g.bannerUrl).slice(0, 4);
  useEffect(() => {
    if (slides.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, [slides.length]);
  if (!slides.length) return null;
  return (
    <div className="banner" aria-roledescription="carousel">
      {slides.map((g, n) => (
        <div key={g.id} className={`slide ${n === i ? 'on' : ''}`} style={{ backgroundImage: `url(${g.bannerUrl})` }} aria-hidden={n !== i}>
          <span>{pick(lang, g.nameEn, g.nameKm)}</span>
        </div>
      ))}
      <div className="dots">{slides.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>
    </div>
  );
}
