import { serverApi } from '@/lib/api';
import type { Game } from '@/lib/types';
import Banner from '@/components/Banner';
import { Featured, TelegramCard } from '@/components/HomeSections';

export const dynamic = 'force-dynamic'; // an admin's OFF switch must show up on the next page view

export default async function Home() {
  const games = (await serverApi<Game[]>('/games')) ?? [];
  return (<><Banner games={games} /><TelegramCard /><Featured games={games} /></>);
}
