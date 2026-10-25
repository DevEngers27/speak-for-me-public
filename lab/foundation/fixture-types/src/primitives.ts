/**
 * Primitive value schemas shared by every part of a scenario fixture.
 *
 * These encode representation rules only (identifier syntax, integer minor
 * units, calendar dates). They carry no scenario semantics.
 */
import { z } from "zod";

/**
 * Identifier syntax for every id in a fixture (roles, participants, items,
 * constraints, phases, expectations) and for open vocabularies such as
 * constraint kinds and reason codes.
 *
 * Lowercase ASCII, starts with a letter, segments joined by a single `-`, `_`
 * or `.`. Compatible with the scenario id rule `^[a-z][a-z0-9-]*$`.
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 64;

export const Slug = z.string().min(1).max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN);

/** A short human-readable name. Must contain at least one non-space character. */
export const Label = z.string().min(1).max(200).regex(/\S/);

/** Longer free text (descriptions, notes). */
export const Text = z.string().min(1).max(4000).regex(/\S/);

/**
 * A monetary amount in integer minor units (cents for USD).
 *
 * `z.int()` already restricts values to `Number.isSafeInteger`, which keeps
 * amounts exact when stored as a Convex `v.number()` (float64). Negative values
 * are rejected: fixtures describe prices, caps and totals, never deltas.
 */
export const Cents = z.int().nonnegative();

/**
 * A calendar date `YYYY-MM-DD` with no time and no offset. Zod 4 validates the
 * real calendar, so `2026-02-30` and `2026-02-29` are rejected while
 * `2028-02-29` is accepted. Same-format dates compare correctly as strings.
 */
export const IsoDate = z.iso.date();

/** ISO 4217-style alphabetic currency code, e.g. `USD`. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);

/**
 * An opaque JSON object. Used for content the generic fixture layer must not
 * interpret (private briefs, constraint parameters). `z.json()` rejects
 * `undefined`, functions, `NaN` and `Infinity`, so the value always survives a
 * JSON round trip and can be stored in Convex.
 */
export const JsonRecord = z.record(z.string(), z.json());

/** List of distinct slugs. Duplicates are reported by the cross-reference pass. */
export const SlugList = z.array(Slug);
