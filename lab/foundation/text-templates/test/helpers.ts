import assert from 'node:assert/strict';
import { TemplateError, type TemplateErrorCode } from '../src/index.ts';

/** Asserts fn throws a TemplateError with the given code, and that the message never leaks `secret`. */
export function assertTemplateError(fn: () => unknown, code: TemplateErrorCode, secret?: string): TemplateError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof TemplateError, `expected TemplateError ${code}, got ${String(caught)}`);
  assert.equal(caught.code, code, caught.message);
  if (secret !== undefined) {
    assert.ok(!caught.message.includes(secret), `error message leaked a value: ${caught.message}`);
    assert.ok(!caught.reason.includes(secret));
  }
  return caught;
}

/** Bypasses compile-time checks to exercise runtime validation, as a JS caller or a cast would. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loose(value: unknown): any {
  return value;
}
