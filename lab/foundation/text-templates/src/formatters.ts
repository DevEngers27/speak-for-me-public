/**
 * Formatters turn validated canonical values into display strings. They are
 * injected by the caller (the engine binds currency, locale and time zone per
 * room/scenario); this package never decides how money or dates look.
 *
 * Contract: formatters must be pure and deterministic (same input, same
 * output; no clock, no randomness, no environment-dependent locale data) for
 * rendering to be deterministic. Their output is passed through the encoder
 * like any other slot output.
 */
export interface Formatters {
  /** Integer minor units (e.g. cents). Sign allowed only if the slot is `signed`. */
  readonly amount: (minorUnits: number) => string;
  /** A validated calendar date in `YYYY-MM-DD` form. */
  readonly date: (isoDate: string) => string;
  /** A safe integer (version numbers, counts). */
  readonly integer: (value: number) => string;
  /** Joins already-validated list items, e.g. `["LOGIN", "REPORTS"] -> "LOGIN + REPORTS"`. */
  readonly list: (items: readonly string[]) => string;
}

export interface ReferenceFormatterOptions {
  /** Prefix for amounts, e.g. "$". Default "$". */
  readonly currencySymbol?: string;
  /** Number of minor digits (2 for USD cents, 0 for JPY). Default 2. */
  readonly minorDigits?: number;
  /** When true, whole amounts drop the minor part ("$900" instead of "$900.00"). Default true. */
  readonly omitZeroMinor?: boolean;
  /** List separator. Default " + ". */
  readonly listSeparator?: string;
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * A deterministic, dependency-free formatter set (no Intl, no ICU data), used
 * by tests and examples and usable as an en-US default. Real deployments may
 * inject Intl-based formatters instead, provided they pin locale and options.
 */
export function createReferenceFormatters(options: ReferenceFormatterOptions = {}): Formatters {
  const symbol = options.currencySymbol ?? '$';
  const minorDigits = options.minorDigits ?? 2;
  const omitZeroMinor = options.omitZeroMinor ?? true;
  const separator = options.listSeparator ?? ' + ';
  if (!Number.isInteger(minorDigits) || minorDigits < 0 || minorDigits > 6) {
    throw new RangeError('minorDigits must be an integer in [0, 6]');
  }
  const scale = 10n ** BigInt(minorDigits);

  return Object.freeze({
    amount(minorUnits: number): string {
      const n = BigInt(minorUnits);
      const negative = n < 0n;
      const abs = negative ? -n : n;
      const major = groupThousands((abs / scale).toString());
      const minor = (abs % scale).toString().padStart(minorDigits, '0');
      const tail = minorDigits === 0 || (omitZeroMinor && abs % scale === 0n) ? '' : `.${minor}`;
      return `${negative ? '-' : ''}${symbol}${major}${tail}`;
    },
    date(isoDate: string): string {
      return isoDate;
    },
    integer(value: number): string {
      return String(value);
    },
    list(items: readonly string[]): string {
      return items.join(separator);
    },
  });
}
