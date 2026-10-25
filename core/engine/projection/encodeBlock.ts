/** The only prompt-block escaping implementation (05 §5.13.2). */
export function encodeBlock(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined)
    throw new TypeError('Block value must be JSON serializable');
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
