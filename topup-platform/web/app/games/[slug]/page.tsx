import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api';
import type { Game } from '@/lib/types';
import Checkout from '@/components/Checkout';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: { slug: string } }) {
  if (!/^[a-z0-9-]{2,40}$/.test(params.slug)) notFound();
  const game = await serverApi<Game>(`/games/${params.slug}`);
  if (!game) notFound(); // disabled games 404 immediately
  return <Checkout game={game} />;
}
