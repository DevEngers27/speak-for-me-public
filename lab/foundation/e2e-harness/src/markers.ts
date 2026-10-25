import type { Page } from "@playwright/test";

/**
 * Marker ("canary") scanning across what a role's browser actually received.
 * Seed a unique string into one role's private input, then assert it never
 * reaches another role's DOM or realtime transport. Scenario-agnostic: the
 * caller decides which markers belong to whom.
 */

export interface TextSample {
  /** Where the text came from, e.g. "dom", "ws:received". */
  readonly source: string;
  readonly text: string;
}

export interface MarkerHit {
  readonly marker: string;
  readonly source: string;
  /** Up to 40 chars either side of the first occurrence, for the report. */
  readonly excerpt: string;
}

/** Pure scan: every (marker, source) pair that occurs, first occurrence only. */
export function findMarkers(samples: Iterable<TextSample>, markers: readonly string[]): MarkerHit[] {
  const wanted = markers.filter((m) => m.length > 0);
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
  /** True once the byte budget was exhausted and later frames were dropped. */
  readonly truncated: boolean;
}

/**
 * Record WebSocket frames (both directions) for a page, bounded by a byte
 * budget so long tests cannot exhaust memory. Binary frames are decoded as
 * UTF-8 so JSON-over-binary payloads are still scannable.
 */
export function recordWebSocketFrames(page: Page, maxBytes = 4 * 1024 * 1024): TransportLog {
  const samples: TextSample[] = [];
  const log = { samples, truncated: false };
  let used = 0;
  const push = (source: string, payload: string | Buffer) => {
    const text = typeof payload === "string" ? payload : payload.toString("utf8");
    if (used + text.length > maxBytes) {
      log.truncated = true;
      return;
    }
    used += text.length;
    samples.push({ source, text });
  };
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => push(`ws:received ${ws.url()}`, frame.payload));
    ws.on("framesent", (frame) => push(`ws:sent ${ws.url()}`, frame.payload));
  });
  return log;
}

/** Current DOM (including attribute values and hidden nodes) as a sample. */
export async function domSample(page: Page): Promise<TextSample> {
  const text = await page.evaluate(() => document.documentElement.outerHTML);
  return { source: `dom ${page.url()}`, text };
}
