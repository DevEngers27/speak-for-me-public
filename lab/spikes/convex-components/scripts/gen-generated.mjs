// Offline stand-in for `npx convex codegen` (which requires a deployment when components are used).
// Uses Convex 1.48's own codegen templates; mirrors how real codegen types `components`.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2]);
// NOTE: convex's template modules import CLI-only deps (chalk) -> reproduce their output by hand.
const apiCodegen = (mods) => ({
  DTS: `/* eslint-disable */
// Generated offline (equivalent of convex codegen api.d.ts)
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
${mods.map((m) => `import type * as ${m} from "../${m}.js";`).join("\n")}
declare const fullApi: ApiFromModules<{
${mods.map((m) => `  "${m}": typeof ${m},`).join("\n")}
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
`,
  JS: `/* eslint-disable */
import { anyApi } from "convex/server";
export const api = anyApi;
export const internal = anyApi;
`,
});
const dynamicDataModelDTS = () => `/* eslint-disable */
import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel, SystemTableNames } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`;
const convexDir = path.join(root, "convex");
const modules = fs.readdirSync(convexDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts") && !["schema.ts", "convex.config.ts"].includes(f))
  .map((f) => f.replace(/\.ts$/, ""))
  .sort();
// component instance name -> package
const components = { workflow: "@convex-dev/workflow", modelPool: "@convex-dev/workpool", actionRetrier: "@convex-dev/action-retrier", rateLimiter: "@convex-dev/rate-limiter" };
const out = path.join(convexDir, "_generated");
fs.mkdirSync(out, { recursive: true });
const api = apiCodegen(modules);
const compDecl = `\nexport declare const components: {\n${Object.entries(components)
  .map(([n, p]) => `  "${n}": import("${p}/_generated/component.js").ComponentApi<"${n}">,`).join("\n")}\n};\n`;
fs.writeFileSync(path.join(out, "api.d.ts"), api.DTS + compDecl);
fs.writeFileSync(path.join(out, "api.js"), api.JS.replace('import { anyApi } from "convex/server";', 'import { anyApi, componentsGeneric } from "convex/server";') + "\nexport const components = componentsGeneric();\n");
// server.* hand-written: the template module transitively imports CLI-only deps (chalk).
fs.writeFileSync(path.join(out, "server.d.ts"), `/* eslint-disable */
// Generated offline (equivalent of convex codegen server.d.ts)
import type { ActionBuilder, HttpActionBuilder, MutationBuilder, QueryBuilder, GenericActionCtx, GenericMutationCtx, GenericQueryCtx, GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "./dataModel.js";
export declare const query: QueryBuilder<DataModel, "public">;
export declare const internalQuery: QueryBuilder<DataModel, "internal">;
export declare const mutation: MutationBuilder<DataModel, "public">;
export declare const internalMutation: MutationBuilder<DataModel, "internal">;
export declare const action: ActionBuilder<DataModel, "public">;
export declare const internalAction: ActionBuilder<DataModel, "internal">;
export declare const httpAction: HttpActionBuilder;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
`);
fs.writeFileSync(path.join(out, "server.js"), `/* eslint-disable */
import { actionGeneric, httpActionGeneric, queryGeneric, mutationGeneric, internalActionGeneric, internalMutationGeneric, internalQueryGeneric } from "convex/server";
export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;
export const httpAction = httpActionGeneric;
`);
fs.writeFileSync(path.join(out, "dataModel.d.ts"), dynamicDataModelDTS());
console.log("generated for modules:", modules.join(", "));
