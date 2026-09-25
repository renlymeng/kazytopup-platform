import { cfg } from '../config';

export interface SupplierCfg {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
  okPath?: string;
  okValue?: unknown;
  resultPath?: string;
}

const walk = (o: any, path?: string) => (path ? path.split('.').reduce((a, k) => a?.[k], o) : undefined);

const interp = (v: any, vars: Record<string, string>, enc: boolean): any => {
  if (typeof v === 'string')
    return v
      .replace(/\{\{(\w+)\}\}/g, (_, k) => (enc ? encodeURIComponent(vars[k] ?? '') : vars[k] ?? ''))
      .replace(/\$\{ENV:(SUPPLIER_\w+)\}/g, (_, k) => process.env[k] ?? '');
  if (Array.isArray(v)) return v.map((x) => interp(x, vars, false));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, interp(x, vars, false)]));
  return v;
};

export function assertSupplierCfg(c: unknown): asserts c is SupplierCfg {
  const s = c as SupplierCfg;
  if (!s || typeof s.url !== 'string') throw new Error('Supplier config needs a url');
  const u = new URL(s.url.replace(/\{\{\w+\}\}/g, 'x'));
  if (u.protocol !== 'https:' || !cfg.supplierHosts.includes(u.hostname))
    throw new Error(`Host ${u.hostname} is not in SUPPLIER_HOST_ALLOWLIST`);
}

export async function callSupplier(c: SupplierCfg, vars: Record<string, string>) {
  assertSupplierCfg(c);
  const url = new URL(interp(c.url, vars, true));
  if (url.protocol !== 'https:' || !cfg.supplierHosts.includes(url.hostname)) throw new Error('SUPPLIER_HOST_NOT_ALLOWED');
  const method = c.method ?? 'POST';
  const res = await fetch(url, {
    method,
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(interp(c.headers ?? {}, vars, false) as Record<string, string>) },
    body: method === 'POST' ? JSON.stringify(interp(c.body ?? {}, vars, false)) : undefined,
    signal: AbortSignal.timeout(c.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`SUPPLIER_HTTP_${res.status}`);
  const raw = await res.json();
  const ok = c.okPath ? walk(raw, c.okPath) === c.okValue : true;
  return { ok, result: walk(raw, c.resultPath) as unknown, raw };
}
