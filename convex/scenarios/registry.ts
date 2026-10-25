import { scopeChangePlugin } from '../../core/scenarios/scope-change';
import { appError } from '../lib/errors';

// Version-pinned upstream W1-3 plugin registry.
const registry = new Map([['scope_change@1', scopeChangePlugin]]);

export function scenarioOf(room: { scenarioKey: string; scenarioVersion: number }) {
  const plugin = registry.get(`${room.scenarioKey}@${room.scenarioVersion}`);
  if (!plugin) throw appError('run.invalid_state', { guard: 'scenario_version' });
  return plugin;
}

export function latestScenarioVersion(scenarioKey: string): number {
  const versions = [...registry.keys()]
    .filter(key => key.startsWith(`${scenarioKey}@`))
    .map(key => Number(key.slice(key.lastIndexOf('@') + 1)));
  if (!versions.length) throw appError('run.invalid_state', { guard: 'scenario_version' });
  return Math.max(...versions);
}
