/* Hand-written stand-in for `npx convex codegen` output (codegen needs a live
 * deployment, which this offline spike does not have). Shape matches the
 * generated file closely enough for typing and convex-test module discovery. */
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";
import type schema from "../schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | "_scheduled_functions" | "_storage"> =
  GenericId<TableName>;
