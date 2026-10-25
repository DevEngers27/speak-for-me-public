// Spelling variants for secrets: money, dates, opaque canary strings.
import type { SecretField } from './types.ts';

export interface Matcher {
  variant: string;
  re: RegExp; // global, unicode, case-insensitive
  /** skeleton matchers run against the alnum-only skeleton of the text */
  onSkeleton?: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ASCII-only boundaries so that "预算4800元" still matches while "k4800x" (ids) does not.
const NUM_START = '(?<![A-Za-z0-9_])(?<!\\d[.,])';
const NUM_END = '(?:(?=\\s?(?:usd|dollars?|bucks))|(?![A-Za-z0-9_]))(?!\\d)(?![.,]\\d)';
const num = (body: string) => new RegExp(NUM_START + body + NUM_END, 'giu');

/** Normalize text before scanning: NFKC (full-width digits), strip zero-width, unify spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[    　]/g, ' ');
}

/** Lowercase alnum-only skeleton (catches c-a-n-a-r-y_fin 7731 style splitting). */
export function skeleton(s: string): string {
  return normalizeText(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under1000(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)]!, 'hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]! + (n % 10 ? '-' + ONES[n % 10] : '')); }
  else if (n > 0) out.push(ONES[n]!);
  return out;
}

/** English words for an integer < 1e9, e.g. 4800 -> "four thousand eight hundred". */
export function numberToWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  const m = Math.floor(n / 1e6), t = Math.floor((n % 1e6) / 1000), r = n % 1000;
  if (m) parts.push(...under1000(m), 'million');
  if (t) parts.push(...under1000(t), 'thousand');
  if (r) parts.push(...under1000(r));
  return parts.join(' ');
}

const wordsRe = (words: string) =>
  new RegExp('(?<![a-z])' + words.split(/[\s-]+/).map(esc).join('(?:[\\s,-]+(?:and[\\s]+)?)') + '(?![a-z-])', 'giu');

function groupThousands(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function moneyMatchers(cents: number): Matcher[] {
  const out: Matcher[] = [];
  const whole = cents % 100 === 0;
  const d = Math.floor(cents / 100);
  const ds = String(d);
  const cc = String(cents % 100).padStart(2, '0');
  const add = (variant: string, body: string) => out.push({ variant, re: num(body) });

  if (whole) {
    add('money:plain', esc(ds));
    if (d >= 1000) {
      add('money:grouped', esc(groupThousands(ds, ',')));
      add('money:space-grouped', esc(groupThousands(ds, ' ')));
      add('money:dot-grouped', esc(groupThousands(ds, '.')) + '(?:,00)?');
    }
    add('money:decimal', esc(ds) + '\\.00');
    if (d >= 1000) add('money:grouped-decimal', esc(groupThousands(ds, ',')) + '\\.00');
    if (d >= 1000 && d % 100 === 0) {
      const k = (d / 1000).toString(); // 4800 -> "4.8", 5000 -> "5"
      out.push({ variant: 'money:k', re: new RegExp(NUM_START + esc(k) + '\\s?(?:k|thousand|grand)(?![a-z])', 'giu') });
    }
    out.push({ variant: 'money:words', re: wordsRe(numberToWords(d)) });
    if (d >= 1100 && d < 10000 && d % 100 === 0 && d % 1000 !== 0) {
      out.push({ variant: 'money:words-hundreds', re: wordsRe(numberToWords(d / 100) + ' hundred') });
    }
  } else {
    add('money:decimal', esc(ds) + '\\.' + cc);
    if (d >= 1000) add('money:grouped-decimal', esc(groupThousands(ds, ',')) + '\\.' + cc);
  }
  // integer cents as written by code or logs (480000 / 480,000), only when distinct from dollars
  add('money:cents', esc(String(cents)));
  if (cents >= 1000) add('money:cents-grouped', esc(groupThousands(String(cents), ',')));
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

export function dateMatchers(iso: string): Matcher[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('bad date ' + iso);
  const [, y, mo, da] = m as unknown as [string, string, string, string];
  const mi = Number(mo), di = Number(da);
  const full = MONTHS[mi - 1]!, short = full.slice(0, 3);
  const dd = `0?${di}`, mm = `0?${mi}`;
  const ord = `${di}(?:st|nd|rd|th)?`;
  const out: Matcher[] = [
    { variant: 'date:iso', re: num(`${y}[-/.]${mo}[-/.]${da}`) },
    { variant: 'date:us', re: num(`${mm}/${dd}/(?:${y}|${y.slice(2)})`) },
    { variant: 'date:eu', re: num(`${dd}[/.]${mm}[/.](?:${y}|${y.slice(2)})`) },
    { variant: 'date:month-day', re: new RegExp(`(?<![a-z])(?:${full}|${short}\\.?)\\s+${ord}(?!\\d)`, 'giu') },
    { variant: 'date:day-month', re: new RegExp(`(?<!\\d)${ord}\\s+(?:of\\s+)?(?:${full}|${short})(?![a-z])`, 'giu') },
    { variant: 'date:zh', re: new RegExp(`(?:${y}年)?${mi}月${di}日`, 'gu') },
  ];
  return out;
}

export function stringMatchers(value: string): Matcher[] {
  const sk = skeleton(value);
  const out: Matcher[] = [
    { variant: 'string:exact-ci', re: new RegExp(esc(normalizeText(value)), 'giu') },
  ];
  if (sk.length >= 8) {
    out.push({ variant: 'string:skeleton', re: new RegExp(esc(sk), 'g'), onSkeleton: true });
    out.push({ variant: 'string:reversed', re: new RegExp(esc([...sk].reverse().join('')), 'g'), onSkeleton: true });
  }
  return out;
}

export function matchersFor(secret: SecretField): Matcher[] {
  switch (secret.kind) {
    case 'money': return moneyMatchers(Number(secret.value));
    case 'date': return dateMatchers(String(secret.value));
    case 'string': return stringMatchers(String(secret.value));
  }
}

/** Decoding layers: text hidden as base64 / percent-encoding is decoded and rescanned. */
export function decodedViews(s: string): { via: string; text: string }[] {
  const views: { via: string; text: string }[] = [];
  if (/%[0-9a-f]{2}/i.test(s)) {
    try { views.push({ via: 'url', text: decodeURIComponent(s) }); } catch { /* ignore malformed */ }
  }
  for (const tok of s.match(/[A-Za-z0-9+/_-]{12,}={0,2}/g) ?? []) {
    try {
      const txt = Buffer.from(tok.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (/^[\x20-\x7E\s]{6,}$/.test(txt)) views.push({ via: 'base64', text: txt });
    } catch { /* ignore */ }
  }
  return views;
}
