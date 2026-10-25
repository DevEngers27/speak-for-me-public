import { describe, expect, test } from 'vitest';
import { defineDisclosureMatrix, pickExact, projectByRole, projectInto } from '../src/index.ts';
import { CANARY, makeRecord, type ExampleRecord } from './fixtures.ts';

/** Wraps a record in a Proxy that records every property read. */
function recordingProxy<T extends object>(target: T): { proxy: T; reads: Set<PropertyKey> } {
  const reads = new Set<PropertyKey>();
  const proxy = new Proxy(target, {
    get(t, key, receiver) {
      reads.add(key);
      return Reflect.get(t, key, receiver);
    },
  });
  return { proxy, reads };
}

const matrix = defineDisclosureMatrix<ExampleRecord>()({
  roles: ['owner', 'peer', 'auditor'],
  fields: {
    id: ['owner', 'peer', 'auditor'],
    title: ['owner', 'peer', 'auditor'],
    sharedNote: ['owner', 'peer'],
    amountCents: ['owner', 'auditor'],
    privateNote: ['owner'],
    internalScore: [],
  },
});
const project = projectByRole(matrix);

describe('pickExact runtime', () => {
  const toSummary = pickExact<ExampleRecord, 'id' | 'title'>()(['id', 'title']);

  test('copies only listed keys into a fresh object', () => {
    const rec = makeRecord();
    const out = toSummary(rec);
    expect(out).toEqual({ id: 'rec_1', title: 'Example title' });
    expect(out).not.toBe(rec);
    expect(Object.keys(out)).toEqual(['id', 'title']);
  });

  test('private field cannot appear even when a structurally wider object is passed', () => {
    const wider = { ...makeRecord(), extraSecret: CANARY, nested: { canary: CANARY } };
    const out = toSummary(wider); // compiles: TS allows wider non-literal objects
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out).not.toHaveProperty('privateNote');
    expect(out).not.toHaveProperty('extraSecret');
  });

  test('reads only the listed properties (never spreads the source)', () => {
    const { proxy, reads } = recordingProxy(makeRecord());
    toSummary(proxy);
    expect([...reads].filter((k) => typeof k === 'string').sort()).toEqual(['id', 'title']);
  });

  test('ignores inherited properties and keeps absent optional fields absent', () => {
    const proto = { id: 'inherited', title: 'inherited' };
    const obj = Object.create(proto) as ExampleRecord;
    expect(toSummary(obj)).toEqual({});
    const withNote = pickExact<ExampleRecord, 'id' | 'sharedNote'>()(['id', 'sharedNote']);
    const rec = makeRecord();
    delete rec.sharedNote;
    expect(Object.hasOwn(withNote(rec), 'sharedNote')).toBe(false);
  });

  test('exposes a frozen key list for audits', () => {
    expect(toSummary.keys).toEqual(['id', 'title']);
    expect(Object.isFrozen(toSummary.keys)).toBe(true);
  });

  test('rejects invalid key lists that bypass the type system', () => {
    const loose = pickExact<ExampleRecord, 'id'>() as unknown as (keys: unknown[]) => unknown;
    expect(() => loose(['id', 'id'])).toThrow(/duplicate/);
    expect(() => loose([''])).toThrow(/non-empty/);
    expect(() => toSummary(null as unknown as ExampleRecord)).toThrow(TypeError);
  });

  test('a "__proto__" key stays an own data property and does not pollute prototypes', () => {
    type Weird = { __proto__: string; id: string };
    const src = JSON.parse('{"__proto__":"x","id":"a"}') as Weird;
    const out = pickExact<Weird, '__proto__' | 'id'>()(['__proto__', 'id'])(src);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
  });
});

describe('projectInto runtime', () => {
  test('returns only DTO keys', () => {
    const toDto = projectInto<ExampleRecord, { id: string; amountCents: number }>()(['id', 'amountCents']);
    expect(toDto(makeRecord())).toEqual({ id: 'rec_1', amountCents: 12345 });
  });
});

describe('projectByRole runtime', () => {
  test('each role receives exactly the keys the matrix grants', () => {
    const rec = makeRecord();
    expect(Object.keys(project('owner', rec)).sort()).toEqual(['amountCents', 'id', 'privateNote', 'sharedNote', 'title']);
    expect(Object.keys(project('peer', rec)).sort()).toEqual(['id', 'sharedNote', 'title']);
    expect(Object.keys(project('auditor', rec)).sort()).toEqual(['amountCents', 'id', 'title']);
  });

  test('private field cannot appear in any non-owner projection (canary scan)', () => {
    const rec = makeRecord();
    for (const role of ['peer', 'auditor'] as const) {
      const json = JSON.stringify(project(role, rec));
      expect(json).not.toContain(CANARY);
      expect(json).not.toContain(String(rec.internalScore));
    }
    expect(JSON.stringify(project('owner', rec))).toContain(CANARY);
    expect(JSON.stringify(project('owner', rec))).not.toContain(String(rec.internalScore));
  });

  test('fields outside the matrix never leak, even on a wider object', () => {
    const wider = { ...makeRecord(), unknownField: CANARY };
    for (const role of matrix.roles) {
      expect(JSON.stringify(project(role, wider))).not.toContain(`"unknownField"`);
    }
  });

  test('reads only granted properties', () => {
    const { proxy, reads } = recordingProxy(makeRecord());
    project('peer', proxy);
    expect([...reads].filter((k) => typeof k === 'string').sort()).toEqual(['id', 'sharedNote', 'title']);
  });

  test('unknown role at runtime throws instead of returning a partial view', () => {
    const anyProject = project as unknown as (role: string, src: ExampleRecord) => unknown;
    expect(() => anyProject('stranger', makeRecord())).toThrow(RangeError);
    expect(() => anyProject('toString', makeRecord())).toThrow(RangeError);
    expect(() => anyProject('__proto__', makeRecord())).toThrow(RangeError);
  });

  test('forRole pre-binds and validates once', () => {
    const forPeer = project.forRole('peer');
    expect(forPeer(makeRecord())).toEqual({ id: 'rec_1', title: 'Example title', sharedNote: 'visible to owner and peer' });
    expect(() => (project.forRole as (r: string) => unknown)('nobody')).toThrow(RangeError);
  });

  test('matrix is frozen and lists keys per role', () => {
    expect(Object.isFrozen(matrix)).toBe(true);
    expect(Object.isFrozen(matrix.keysByRole.peer)).toBe(true);
    expect(matrix.keysByRole.peer).toEqual(['id', 'title', 'sharedNote']);
  });

  test('runtime validation catches matrices built around the type system', () => {
    const define = defineDisclosureMatrix<ExampleRecord>() as unknown as (spec: unknown) => unknown;
    const fields = { id: [], title: [], sharedNote: [], amountCents: [], privateNote: [], internalScore: [] };
    expect(() => define({ roles: ['a', 'a'], fields })).toThrow(/duplicate role/);
    expect(() => define({ roles: [], fields })).toThrow(/at least one role/);
    expect(() => define({ roles: ['a'], fields: { ...fields, id: ['b'] } })).toThrow(/undeclared role/);
    expect(() => define({ roles: ['a'], fields: { ...fields, id: ['a', 'a'] } })).toThrow(/repeats role/);
    expect(() => define({ roles: ['a'], fields: { ...fields, id: 'a' } })).toThrow(/array of roles/);
  });
});
