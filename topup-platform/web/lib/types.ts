export type Pkg = { id: string; labelEn: string; labelKm: string | null; priceCents: number };
export type Game = {
  id: string; slug: string; nameEn: string; nameKm: string | null; iconUrl: string; bannerUrl: string | null;
  hot: boolean; instant: boolean; idLabelEn: string; idLabelKm: string; idMin: number; idMax: number;
  idNumeric: boolean; needsServerId: boolean; serverMax: number; packages?: Pkg[];
};
export const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
