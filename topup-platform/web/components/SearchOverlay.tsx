'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Game } from '@/lib/types';
import GameCard from './GameCard';

export default function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [games, setGames] = useState<Game[] | null>(null);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    api<Game[]>('/games').then(setGames).catch(() => setGames([]));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (games ?? []).filter((g) => !s || g.nameEn.toLowerCase().includes(s) || (g.nameKm ?? '').toLowerCase().includes(s));
  }, [games, q]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t.search}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <input ref={ref} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPh} aria-label={t.search} />
        {games && hits.length === 0 && <p className="muted">{t.noResults}</p>}
        <div className="grid" aria-live="polite">{hits.map((g) => <GameCard key={g.id} g={g} onNavigate={onClose} />)}</div>
      </div>
    </div>
  );
}
