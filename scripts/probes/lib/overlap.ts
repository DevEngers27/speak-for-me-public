/** Half-open intervals. A call that ends as another starts does not overlap. */
export function maxConcurrentIntervals(intervals: readonly (readonly [number, number])[]): number {
  const events: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    events.push([start, 1]);
    events.push([end, -1]);
  }
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let current = 0;
  let max = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > max) max = current;
  }
  return max;
}
