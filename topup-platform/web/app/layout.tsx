import type { Metadata, Viewport } from 'next';
import { Outfit, Noto_Sans_Khmer } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { I18nProvider, Lang } from '@/lib/i18n';
import { ThemeProvider, themeInitScript } from '@/lib/theme';
import Header from '@/components/Header';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });
const khmer = Noto_Sans_Khmer({ subsets: ['khmer'], variable: '--font-khmer', display: 'swap' });

export const metadata: Metadata = { title: 'Game Top-Up · Instant delivery with KHQR', description: 'Top up your favourite games instantly and pay with KHQR.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang: Lang = cookies().get('lang')?.value === 'km' ? 'km' : 'en';
  const nonce = headers().get('x-nonce') ?? undefined;
  return (
    <html lang={lang} suppressHydrationWarning className={`${outfit.variable} ${khmer.variable}`} data-theme="dark">
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>
        <ThemeProvider><I18nProvider initial={lang}>
          <Header />
          <main className="wrap">{children}</main>
        </I18nProvider></ThemeProvider>
      </body>
    </html>
  );
}
