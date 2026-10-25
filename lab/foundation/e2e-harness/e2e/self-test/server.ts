import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Tiny in-process app used only to test the harness itself. It models the
 * two properties multi-role tests rely on, with no business semantics:
 *  - per-browser identity (a cookie set by /login?as=X), and
 *  - shared server state per "space" that pages observe by polling
 *    (standing in for a realtime subscription).
 */
export interface SelfTestServer {
  readonly url: string;
  close(): Promise<void>;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function page(who: string, space: string): string {
  // The private marker is rendered only for the identity it belongs to.
  const marker = who === "anonymous" ? "" : `<p data-testid="private">PRIVATE-MARKER-${escapeHtml(who)}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>harness self-test</title></head>
<body><main>
  <span data-testid="who">${escapeHtml(who)}</span>
  <output data-testid="counter">…</output>
  <button data-testid="increment" type="button">increment</button>
  ${marker}
  <div data-testid="ready" hidden>ready</div>
</main>
<script>
  const space = ${JSON.stringify(space)};
  const out = document.querySelector('[data-testid=counter]');
  const ready = document.querySelector('[data-testid=ready]');
  async function poll() {
    const r = await fetch('/api/counter?space=' + encodeURIComponent(space));
    out.textContent = String((await r.json()).value);
    ready.hidden = false;
  }
  document.querySelector('[data-testid=increment]').addEventListener('click', async () => {
    await fetch('/api/counter?space=' + encodeURIComponent(space), { method: 'POST' });
    await poll();
  });
  poll(); setInterval(poll, 100);
</script></body></html>`;
}

export async function startSelfTestServer(): Promise<SelfTestServer> {
  const counters = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const space = url.searchParams.get("space") ?? "default";
    const who = /(?:^|;\s*)who=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "anonymous";

    if (url.pathname === "/login") {
      const as = url.searchParams.get("as") ?? "";
      if (!/^[A-Za-z0-9_-]+$/.test(as)) {
        res.writeHead(400).end("bad identity");
        return;
      }
      res.writeHead(302, { "set-cookie": `who=${as}; Path=/; HttpOnly; SameSite=Lax`, location: `/?space=${encodeURIComponent(space)}` }).end();
      return;
    }
    if (url.pathname === "/api/counter") {
      if (req.method === "POST") counters.set(space, (counters.get(space) ?? 0) + 1);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ value: counters.get(space) ?? 0 }));
      return;
    }
    if (url.pathname === "/boom") {
      res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><script>setTimeout(() => { throw new Error("boom from page") }, 0)</script>`);
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(who, space));
      return;
    }
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
