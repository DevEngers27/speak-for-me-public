// Framework-free engine core: types, plugin contract, pure rules.
// MUST NOT import from convex/, next, react, or @clerk/*. Enforced by eslint.
export const ENGINE_VERSION = "0.0.0";

export type { ScenarioPlugin } from "./plugin";
export { defineScenario } from "./plugin";
