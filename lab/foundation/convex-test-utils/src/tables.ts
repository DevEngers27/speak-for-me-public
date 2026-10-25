import type { DocumentByName, GenericDataModel, TableNamesInDataModel } from "convex/server";
import type { TestAccessor } from "./identities";

/** Count every row of a table (test-only: unbounded `collect`). */
export async function countRows<DM extends GenericDataModel, TN extends TableNamesInDataModel<DM>>(
  t: TestAccessor<DM>,
  table: TN,
): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
}

/** Read every row of a table, bypassing all function-level access control. */
export async function readAll<DM extends GenericDataModel, TN extends TableNamesInDataModel<DM>>(
  t: TestAccessor<DM>,
  table: TN,
): Promise<DocumentByName<DM, TN>[]> {
  return await t.run(async (ctx) => await ctx.db.query(table).collect());
}
