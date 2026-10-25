import {expect, it} from 'vitest';
import {candidateKey, executionKey, taskKey} from './keys';
it('pins canon string keys without hashes or version segments', () => {
  expect(executionKey('proposal123')).toBe('exec:proposal123');
  expect(taskKey('execution123', 'sso_login', 0)).toBe('execution123:sso_login:0');
  expect(candidateKey(['audit_log_export', 'sso_login'], ['rush'])).toBe('audit_log_export+sso_login@rush');
  expect(candidateKey(['sso_login'])).toBe('sso_login');
  expect(candidateKey(['bb', 'aa'], ['zz', 'aa'])).toBe(candidateKey(['aa', 'bb'], ['aa', 'zz']));
});
it('rejects ambiguous segments, duplicate items, holes, and invalid indices', () => {
  for (const value of ['', 'a:b', 'a+b', 'a@b']) expect(() => executionKey(value)).toThrow();
  for (const index of [-1, 1.5, NaN, Infinity]) expect(() => taskKey('e', 'item', index)).toThrow();
  expect(() => candidateKey([])).toThrow();
  expect(() => candidateKey(['aa', 'aa'])).toThrow();
  expect(() => candidateKey(new Array<string>(2))).toThrow();
});
