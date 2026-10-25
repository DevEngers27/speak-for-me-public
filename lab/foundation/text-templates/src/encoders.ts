/**
 * Output encoders. Every slot's final string passes through exactly one
 * encoder call; literal template text (authored in code, trusted) never does.
 * The encoder is chosen by the output context, not by the template.
 */
export interface Encoder {
  readonly name: string;
  readonly encode: (slotOutput: string) => string;
}

/**
 * Characters that change how text is displayed or split downstream without
 * being visible: C0/C1 controls (incl. CR/LF/TAB), line/paragraph separators,
 * bidi embedding/override/isolate controls, zero-width characters and BOM.
 */
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls, including TAB, LF, CR
  [0x007f, 0x009f], // DEL and C1 controls
  [0x061c, 0x061c], // Arabic letter mark
  [0x200b, 0x200f], // zero-width space/joiners, LRM, RLM
  [0x2028, 0x2029], // line and paragraph separators
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];
const hex = (cp: number): string => `\\u{${cp.toString(16)}}`;
const UNSAFE_CLASS = `[${UNSAFE_RANGES.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join('')}]`;
export const UNSAFE_TEXT_CHARS = new RegExp(UNSAFE_CLASS, 'u');
const UNSAFE_TEXT_CHARS_GLOBAL = new RegExp(UNSAFE_CLASS, 'gu');

/**
 * For plain-text sinks (React text nodes, notifications, model prompts, logs).
 * Slot validation already rejects these characters in data; this is a second
 * line of defence for formatter output, replacing them with U+FFFD.
 */
export const plainTextEncoder: Encoder = Object.freeze({
  name: 'plain-text',
  encode: (s: string) => s.replace(UNSAFE_TEXT_CHARS_GLOBAL, '�'),
});

const HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/** For HTML element content and quoted attribute values (e.g. future e-mail bodies). */
export const htmlEncoder: Encoder = Object.freeze({
  name: 'html',
  encode: (s: string) => plainTextEncoder.encode(s).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c),
});
