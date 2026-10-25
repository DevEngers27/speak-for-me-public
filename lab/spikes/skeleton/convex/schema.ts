import { defineSchema } from "convex/server";
import { engineTables } from "./engine/tables";
import { scopeChangeTables } from "./scenarios/scopeChange/tables";

export default defineSchema({
  ...engineTables,
  ...scopeChangeTables,
});
