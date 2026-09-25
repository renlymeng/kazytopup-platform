'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => { setTheme((document.documentElement.dataset.theme as Theme) || 'dark'); }, []);
  const toggle = () => {
    const n: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(n);
    document.documentElement.dataset.theme = n;
    try { localStorage.setItem('theme', n); } catch {}
  };
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);

// Runs before first paint (nonce'd) so there is no dark/light flash.
export const themeInitScript = `try{var t=localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`;
