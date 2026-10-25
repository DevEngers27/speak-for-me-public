import type { Page } from "@playwright/test";

export interface TextSample {
  readonly source: string;
  readonly text: string;
}

export interface MarkerHit {
  readonly marker: string;
  readonly source: string;
  readonly excerpt: string;
}

export function findMarkers(samples: Iterable<TextSample>, markers: readonly string[]): MarkerHit[] {
  const wanted = markers.filter((marker) => marker.length > 0);
  const hits: MarkerHit[] = [];
  for (const sample of samples) {
    for (const marker of wanted) {
      const at = sample.text.indexOf(marker);
      if (at === -1) continue;
      const start = Math.max(0, at - 40);
      const end = Math.min(sample.text.length, at + marker.length + 40);
      hits.push({ marker, source: sample.source, excerpt: sample.text.slice(start, end) });
    }
  }
  return hits;
}

export interface TransportLog {
  readonly samples: readonly TextSample[];
  readonly truncated: boolean;
}

export interface TransportRecorder {
  readonly log: TransportLog;
  push(source: string, payload: string | Buffer): void;
}

/** Byte budget is UTF-8 bytes. Later frames are dropped and `truncated` becomes true. */
export function createTransportLog(maxBytes = 4 * 1024 * 1024): TransportRecorder {
  const samples: TextSample[] = [];
  const log = { samples, truncated: false };
  let used = 0;
  return {
    log,
    push(source, payload) {
      const text = typeof payload === "string" ? payload : payload.toString("utf8");
      const bytes = Buffer.byteLength(text, "utf8");
      if (used + bytes > maxBytes) {
        log.truncated = true;
        return;
      }
      used += bytes;
      samples.push({ source, text });
    },
  };
}

export function recordWebSocketFrames(page: Page, maxBytes = 4 * 1024 * 1024): TransportLog {
  const recorder = createTransportLog(maxBytes);
  const attach = (target: Page) => {
    target.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => recorder.push(`ws:received ${ws.url()}`, frame.payload));
      ws.on("framesent", (frame) => recorder.push(`ws:sent ${ws.url()}`, frame.payload));
    });
  };
  attach(page);
  page.context().on("page", (next) => {
    if (next !== page) attach(next);
  });
  return recorder.log;
}

/**
 * Scan DOM plus transport. A truncated capture throws: a partial log must not
 * look like a clean privacy check.
 */
export function scanRoleMarkers(log: TransportLog, dom: TextSample, markers: readonly string[]): MarkerHit[] {
  if (log.truncated) {
    throw new Error("transport capture was truncated; a marker scan would be incomplete and cannot pass");
  }
  return findMarkers([dom, ...log.samples], markers);
}

export function expectNoMarkers(log: TransportLog, dom: TextSample, markers: readonly string[]): void {
  const hits = scanRoleMarkers(log, dom, markers);
  if (hits.length > 0) {
    throw new Error(`marker leak: ${hits.map((hit) => `${hit.marker} in ${hit.source}`).join("; ")}`);
  }
}

export async function domSample(page: Page): Promise<TextSample> {
  const text = await page.evaluate(() => document.documentElement.outerHTML);
  return { source: `dom ${page.url()}`, text };
}

export const MAX_OBSERVED_ERRORS = 100;

export function pushCapped<T>(items: T[], value: T, max = MAX_OBSERVED_ERRORS): void {
  if (items.length < max) items.push(value);
}
