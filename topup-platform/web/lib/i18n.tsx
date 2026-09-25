'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export type Lang = 'en' | 'km';
const dict = {
  en: {
    strip: 'Instant pay · All banks via KHQR · 24/7 Telegram support', join: 'Join',
    joinTitle: 'Join Telegram for new updates', joinSub: 'New games, packs and offers', joinBtn: 'Join channel',
    trending: 'Trending', hotPicks: (n: number) => `${n} hot picks`, featured: 'Featured games',
    tagline: 'Choose a game, enter your ID, pay with KHQR', allGames: 'All games',
    search: 'Search games', searchPh: 'Search by game name', noResults: 'No games match your search.',
    theme: 'Switch theme', language: 'Language', account: 'Account', menu: 'Menu',
    hot: 'HOT', instant: 'INSTANT', noGames: 'No games are available right now. Please check back soon.',
    playerId: 'Player ID', serverId: 'Server ID', verify: 'Verify ID', verifying: 'Checking…', nickname: 'Nickname',
    verified: 'Account found', step1: 'Enter your account', step2: 'Choose a package', step3: 'Contact (optional)',
    contactPh: 'Telegram username or phone', pay: 'Pay with KHQR', total: 'Total', creating: 'Creating payment…',
    scan: 'Scan with any KHQR banking app', openAba: 'Open ABA Mobile', expiresIn: 'Expires in',
    st_PENDING: 'Waiting for payment', st_PAID: 'Payment received', st_DELIVERING: 'Delivering your top-up…',
    st_COMPLETED: 'Top-up delivered. Enjoy your game!', st_FAILED: 'Delivery is delayed. Our team is on it — keep your order code.',
    st_EXPIRED: 'This payment has expired', orderCode: 'Order code', newOrder: 'Start a new order', unavailable: 'This game is unavailable',
    signIn: 'Sign in', signOut: 'Sign out', signInSub: 'Optional. Sign in to keep your order history.', myOrders: 'My orders',
    home: 'Home', support: 'Support on Telegram', selectPkg: 'Select a package first', verifyFirst: 'Verify your ID first',
    idHint: (a: number, b: number) => `${a}–${b} digits`,
  },
  km: {
    strip: 'បង់ប្រាក់ភ្លាមៗ · KHQR គ្រប់ធនាគារ · ជំនួយ 24/7 តាម Telegram', join: 'ចូលរួម',
    joinTitle: 'ចូលរួម Telegram ដើម្បីទទួលព័ត៌មានថ្មី', joinSub: 'ហ្គេមថ្មី កញ្ចប់ និងប្រូម៉ូសិន', joinBtn: 'ចូលរួមឆាណែល',
    trending: 'ពេញនិយម', hotPicks: (n: number) => `${n} ហ្គេមពេញនិយម`, featured: 'ហ្គេមពិសេស',
    tagline: 'ជ្រើសរើសហ្គេម បញ្ចូលលេខ ID ហើយបង់ប្រាក់តាម KHQR', allGames: 'ហ្គេមទាំងអស់',
    search: 'ស្វែងរកហ្គេម', searchPh: 'ស្វែងរកតាមឈ្មោះហ្គេម', noResults: 'រកមិនឃើញហ្គេមដែលត្រូវនឹងការស្វែងរកទេ។',
    theme: 'ប្ដូរផ្ទៃពណ៌', language: 'ភាសា', account: 'គណនី', menu: 'ម៉ឺនុយ',
    hot: 'ពេញនិយម', instant: 'ភ្លាមៗ', noGames: 'បច្ចុប្បន្នមិនមានហ្គេមទេ សូមត្រឡប់មកវិញក្នុងពេលឆាប់ៗ។',
    playerId: 'លេខសម្គាល់អ្នកលេង', serverId: 'លេខ Server', verify: 'ផ្ទៀងផ្ទាត់ ID', verifying: 'កំពុងពិនិត្យ…', nickname: 'ឈ្មោះក្នុងហ្គេម',
    verified: 'រកឃើញគណនី', step1: 'បញ្ចូលគណនីរបស់អ្នក', step2: 'ជ្រើសរើសកញ្ចប់', step3: 'ទំនាក់ទំនង (ស្រេចចិត្ត)',
    contactPh: 'ឈ្មោះ Telegram ឬលេខទូរស័ព្ទ', pay: 'បង់ប្រាក់តាម KHQR', total: 'សរុប', creating: 'កំពុងបង្កើតការបង់ប្រាក់…',
    scan: 'ស្កេនជាមួយកម្មវិធីធនាគារ KHQR ណាមួយ', openAba: 'បើក ABA Mobile', expiresIn: 'ផុតកំណត់ក្នុង',
    st_PENDING: 'កំពុងរង់ចាំការបង់ប្រាក់', st_PAID: 'បានទទួលការបង់ប្រាក់', st_DELIVERING: 'កំពុងបញ្ជូនការបញ្ចូលទឹកប្រាក់…',
    st_COMPLETED: 'ការបញ្ចូលបានជោគជ័យ សូមរីករាយជាមួយហ្គេម!', st_FAILED: 'ការបញ្ជូនយឺតបន្តិច ក្រុមការងារកំពុងដោះស្រាយ សូមរក្សាលេខកូដ។',
    st_EXPIRED: 'ការបង់ប្រាក់នេះបានផុតកំណត់', orderCode: 'លេខកូដការបញ្ជាទិញ', newOrder: 'ចាប់ផ្តើមការបញ្ជាទិញថ្មី', unavailable: 'ហ្គេមនេះមិនអាចប្រើបានទេ',
    signIn: 'ចូលគណនី', signOut: 'ចាកចេញ', signInSub: 'ស្រេចចិត្ត។ ចូលគណនីដើម្បីរក្សាប្រវត្តិទិញ។', myOrders: 'ការបញ្ជាទិញរបស់ខ្ញុំ',
    home: 'ទំព័រដើម', support: 'ជំនួយតាម Telegram', selectPkg: 'សូមជ្រើសរើសកញ្ចប់សិន', verifyFirst: 'សូមផ្ទៀងផ្ទាត់ ID សិន',
    idHint: (a: number, b: number) => `លេខ ${a}–${b} ខ្ទង់`,
  },
};
export type Dict = typeof dict.en;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: Dict }>({ lang: 'en', setLang: () => {}, t: dict.en });

export function I18nProvider({ children, initial }: { children: ReactNode; initial: Lang }) {
  const [lang, setL] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setL(l);
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t: dict[lang] as Dict }}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
export const pick = (lang: Lang, en: string, km?: string | null) => (lang === 'km' && km ? km : en);
