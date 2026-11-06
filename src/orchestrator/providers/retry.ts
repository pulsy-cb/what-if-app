/**
 * A long agent turn makes dozens of sequential requests, and every hosted provider caps that
 * (429 "account request rate limit", 5xx, connection resets). Failing the turn on the first one
 * meant an unattended run died halfway through the pipeline, so we wait and retry instead:
 * 8s, 16s, 32s, 64s, 120s, 120s, honouring retry-after when the provider sends one.
 */
const ATTEMPTS = 6;
const BASE_MS = 8_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const retryable = (status: number) => status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError = '';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if ((init.signal as AbortSignal | undefined)?.aborted) throw err;
      lastError = `network: ${(err as Error).message}`;
      const wait = BASE_MS * 2 ** attempt;
      console.error(`[provider] ${lastError}, retrying in ${wait / 1000}s`);
      await sleep(wait, init.signal as AbortSignal | undefined);
      continue;
    }
    if (res.ok || !retryable(res.status)) return res;

    const body = await res.text().catch(() => '');
    lastError = `${res.status} ${res.statusText}: ${body.slice(0, 300)}`;
    if (attempt === ATTEMPTS - 1) {
      // hand the last response back untouched so the caller reports the provider's own message
      return new Response(body, { status: res.status, statusText: res.statusText });
    }
    const after = Number(res.headers.get('retry-after') ?? '') * 1000;
    const wait = Number.isFinite(after) && after > 0 ? Math.min(after, 180_000) : BASE_MS * 2 ** attempt;
    console.error(`[provider] ${lastError} — retry ${attempt + 1}/${ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`);
    await sleep(wait, init.signal as AbortSignal | undefined);
  }
  return new Response(lastError, { status: 599 });
}
