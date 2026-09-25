export class ApiError extends Error { constructor(msg: string, public status: number, public body: any) { super(msg); } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch('/api' + path, {
    ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = Array.isArray(j.message) ? j.message.join(', ') : j.message;
    throw new ApiError(m ?? `Request failed (${r.status})`, r.status, j);
  }
  return j as T;
}

// Server-side fetch used by server components (goes straight to the API).
export async function serverApi<T>(path: string): Promise<T | null> {
  const r = await fetch((process.env.API_URL ?? 'http://localhost:4000') + '/api' + path, { cache: 'no-store' });
  return r.ok ? ((await r.json()) as T) : null;
}
