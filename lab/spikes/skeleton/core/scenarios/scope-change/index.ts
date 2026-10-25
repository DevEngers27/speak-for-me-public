// First scenario plugin. Depends on @core/engine only.
import { defineScenario } from "../../engine";

export const scopeChangePlugin = defineScenario({
  id: "scope-change",
  version: 1,
  roles: ["customer", "provider", "finance"],
});
