/**
 * Scenario plugin contract (shape only; members are filled in by design doc 06).
 * The engine depends on this interface, never on a concrete scenario.
 */
export interface ScenarioPlugin<Id extends string = string> {
  readonly id: Id;
  readonly version: number;
  readonly roles: readonly string[];
}

export function defineScenario<const Id extends string>(plugin: ScenarioPlugin<Id>): ScenarioPlugin<Id> {
  if (!/^[a-z][a-z0-9-]*$/.test(plugin.id)) {
    throw new Error(`Invalid scenario id: ${plugin.id}`);
  }
  if (new Set(plugin.roles).size !== plugin.roles.length) {
    throw new Error(`Duplicate roles in scenario ${plugin.id}`);
  }
  return plugin;
}
