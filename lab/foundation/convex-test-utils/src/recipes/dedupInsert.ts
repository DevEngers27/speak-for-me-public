/**
 * Test recipe: "query-then-insert inside ONE mutation prevents duplicates".
 *
 * Convex indexes have no unique constraint. The only way to keep "one row per
 * key" is a single write entry point that, in the same mutation, reads the key
 * through an index (preferably with `.unique()`) and inserts only when absent.
 * This recipe checks such an entry point from the outside:
 *
 *   1. clean   - the key has no rows yet (precondition)
 *   2. first   - the first call creates exactly one row
 *   3. serial  - repeated calls return the same id and create nothing
 *   4. burst   - `Promise.all` of repeated calls: same id, still one row
 *   5. scoping - (optional) a different key creates a different row
 *   6. bypass  - (optional) a duplicate inserted behind the entry point's back
 *                makes the entry point fail closed instead of picking one
 *
 * WHAT IT DOES NOT PROVE: convex-test runs one function at a time, so step 4
 * is serialized and says nothing about OCC conflicts between truly concurrent
 * mutations. That needs a test against a real deployment.
 */

export interface DedupRecipe<R> {
  /** Call the write entry point with the SAME logical key every time. */
  callSameKey: () => Promise<R>;
  /** Count rows stored under that key (usually via `t.run` + index). */
  countRows: () => Promise<number>;
  /** Stable document id from the entry point's result. */
  idOf: (result: R) => string;
  /** Call the entry point with a DIFFERENT key (proves the key is not too coarse). */
  callOtherKey?: () => Promise<R>;
  /** Insert a duplicate row for the same key directly (e.g. via `t.run`). */
  bypassInsert?: () => Promise<void>;
  /** Calls per serial / burst phase. Default 3. */
  repeats?: number;
}

export interface DedupReport {
  firstId: string;
  serialIds: string[];
  burstIds: string[];
  otherKeyId: string | undefined;
  /** Present when `bypassInsert` ran: the error the entry point failed closed with. */
  bypassError: unknown;
}

export class DedupRecipeError extends Error {
  readonly step: string;
  constructor(step: string, detail: string) {
    super(`dedup recipe failed at step "${step}": ${detail}`);
    this.name = "DedupRecipeError";
    this.step = step;
  }
}

async function expectRows(step: string, countRows: () => Promise<number>, expected: number): Promise<void> {
  const n = await countRows();
  if (n !== expected) throw new DedupRecipeError(step, `expected ${expected} row(s) for the key, found ${n}`);
}

function expectSameIds(step: string, firstId: string, ids: string[]): void {
  const different = ids.filter((id) => id !== firstId);
  if (different.length > 0) {
    throw new DedupRecipeError(step, `expected every call to return ${firstId}, got ${different.join(", ")}`);
  }
}

export async function verifyQueryThenInsertDedup<R>(recipe: DedupRecipe<R>): Promise<DedupReport> {
  const repeats = recipe.repeats ?? 3;
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("repeats must be a positive integer");

  await expectRows("clean", recipe.countRows, 0);

  const firstId = recipe.idOf(await recipe.callSameKey());
  await expectRows("first", recipe.countRows, 1);

  const serialIds: string[] = [];
  for (let i = 0; i < repeats; i++) serialIds.push(recipe.idOf(await recipe.callSameKey()));
  expectSameIds("serial", firstId, serialIds);
  await expectRows("serial", recipe.countRows, 1);

  const burst = await Promise.all(Array.from({ length: repeats }, () => recipe.callSameKey()));
  const burstIds = burst.map(recipe.idOf);
  expectSameIds("burst", firstId, burstIds);
  await expectRows("burst", recipe.countRows, 1);

  let otherKeyId: string | undefined;
  if (recipe.callOtherKey !== undefined) {
    otherKeyId = recipe.idOf(await recipe.callOtherKey());
    if (otherKeyId === firstId) {
      throw new DedupRecipeError("scoping", "a different key returned the same id; the key is too coarse");
    }
    await expectRows("scoping", recipe.countRows, 1);
  }

  let bypassError: unknown;
  if (recipe.bypassInsert !== undefined) {
    await recipe.bypassInsert();
    await expectRows("bypass", recipe.countRows, 2);
    let resolved = false;
    try {
      await recipe.callSameKey();
      resolved = true;
    } catch (e) {
      bypassError = e;
    }
    if (resolved) {
      throw new DedupRecipeError(
        "bypass",
        "entry point tolerated a duplicate row silently; read the key with .unique() so duplicates fail closed",
      );
    }
  }

  return { firstId, serialIds, burstIds, otherKeyId, bypassError };
}
