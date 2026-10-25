import { isProjected, pickExact, type Projected } from '../../core/engine/projection';
/** Test data only: project each explicitly constructed fixture record recursively. */
export function projectFixture<T extends object>(value: T): Projected<T> {
  const projectValue = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object' || isProjected(entry)) return entry;
    if (Array.isArray(entry)) return entry.map(projectValue);
    return projectFixture(entry);
  };
  const source = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, projectValue(entry)]));
  const copy = pickExact as unknown as (source: object, keys: readonly string[]) => Projected<T>;
  return copy(source, Object.keys(source));
}
