// Compile-time proofs. Checked by `vitest run --typecheck` and by `tsc --noEmit`.
// Every @ts-expect-error MUST produce an error, otherwise tsc reports
// "Unused '@ts-expect-error' directive" and the check fails.
import { describe, expectTypeOf, test } from 'vitest';
import { defineDisclosureMatrix, pickExact, projectByRole, projectInto, type ProjectionOf } from '../src/index.ts';
import { makeRecord, type ExampleRecord } from './fixtures.ts';

const rec = makeRecord();

describe('pickExact', () => {
  test('exact key list compiles and yields Pick<T, K>', () => {
    const toSummary = pickExact<ExampleRecord, 'id' | 'title'>()(['id', 'title']);
    expectTypeOf(toSummary(rec)).toEqualTypeOf<Pick<ExampleRecord, 'id' | 'title'>>();
    expectTypeOf(toSummary(rec)).not.toHaveProperty('privateNote');
    // order does not matter
    pickExact<ExampleRecord, 'id' | 'title'>()(['title', 'id']);
  });

  test('private field cannot be read from projected output', () => {
    const out = pickExact<ExampleRecord, 'id' | 'title'>()(['id', 'title'])(rec);
    // @ts-expect-error privateNote is not part of the projection
    void out.privateNote;
    // @ts-expect-error internalScore is not part of the projection
    void out.internalScore;
  });

  test('missing key fails to compile', () => {
    // @ts-expect-error "title" is declared in K but missing from the list
    pickExact<ExampleRecord, 'id' | 'title'>()(['id']);
  });

  test('extra key fails to compile', () => {
    // @ts-expect-error "privateNote" is not declared in K
    pickExact<ExampleRecord, 'id' | 'title'>()(['id', 'title', 'privateNote']);
  });

  test('duplicate key fails to compile', () => {
    // @ts-expect-error duplicate "id"
    pickExact<ExampleRecord, 'id' | 'title'>()(['id', 'title', 'id']);
  });

  test('non-literal key array fails to compile', () => {
    const keys: ('id' | 'title')[] = [];
    // @ts-expect-error a widened array could be empty or partial
    pickExact<ExampleRecord, 'id' | 'title'>()(keys);
  });

  test('K must be keys of T', () => {
    // @ts-expect-error "nope" is not a key of ExampleRecord
    pickExact<ExampleRecord, 'id' | 'nope'>();
  });
});

describe('projectInto', () => {
  interface SummaryDto {
    id: string;
    title: string;
  }
  test('projects into a declared DTO type', () => {
    const toDto = projectInto<ExampleRecord, SummaryDto>()(['id', 'title']);
    expectTypeOf(toDto(rec)).toEqualTypeOf<SummaryDto>();
  });

  test('DTO with a key the source lacks fails to compile', () => {
    interface BadDto {
      id: string;
      ghost: string;
    }
    // @ts-expect-error "ghost" does not exist on the source
    projectInto<ExampleRecord, BadDto>()(['id', 'ghost']);
  });

  test('DTO with an incompatible field type fails to compile', () => {
    interface WrongTypeDto {
      id: string;
      amountCents: string;
    }
    // @ts-expect-error amountCents is number on the source
    projectInto<ExampleRecord, WrongTypeDto>()(['id', 'amountCents']);
  });

  test('missing DTO key fails to compile', () => {
    // @ts-expect-error "title" missing
    projectInto<ExampleRecord, SummaryDto>()(['id']);
  });
});

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

describe('projectByRole', () => {
  test('owner sees its private field', () => {
    expectTypeOf(project('owner', rec)).toHaveProperty('privateNote');
    expectTypeOf(project('owner', rec)).toEqualTypeOf<Omit<ExampleRecord, 'internalScore'>>();
  });

  test('private field cannot appear in another role projection', () => {
    const peerView = project('peer', rec);
    expectTypeOf(peerView).not.toHaveProperty('privateNote');
    expectTypeOf(peerView).not.toHaveProperty('amountCents');
    expectTypeOf(peerView).not.toHaveProperty('internalScore');
    expectTypeOf(peerView).toEqualTypeOf<Pick<ExampleRecord, 'id' | 'title' | 'sharedNote'>>();
    // @ts-expect-error peer may not read privateNote
    void peerView.privateNote;
    // @ts-expect-error nobody sees internalScore
    void project('owner', rec).internalScore;
  });

  test('optional fields stay optional', () => {
    expectTypeOf(project('peer', rec).sharedNote).toEqualTypeOf<string | undefined>();
  });

  test('union role is the intersection, not the union (fail-closed)', () => {
    const role = 'peer' as 'peer' | 'auditor';
    const view = project(role, rec);
    expectTypeOf(view).toEqualTypeOf<Pick<ExampleRecord, 'id' | 'title'>>();
    expectTypeOf<ProjectionOf<typeof matrix, 'peer' | 'auditor'>>().toEqualTypeOf<Pick<ExampleRecord, 'id' | 'title'>>();
  });

  test('forRole binds the narrowed type', () => {
    const forAuditor = project.forRole('auditor');
    expectTypeOf(forAuditor(rec)).toEqualTypeOf<Pick<ExampleRecord, 'id' | 'title' | 'amountCents'>>();
  });

  test('unknown role fails to compile', () => {
    // @ts-expect-error "stranger" is not a declared role
    project('stranger', rec);
  });

  test('matrix must cover every field', () => {
    defineDisclosureMatrix<ExampleRecord>()({
      roles: ['owner'],
      // @ts-expect-error internalScore has no disclosure decision
      fields: { id: ['owner'], title: ['owner'], sharedNote: ['owner'], amountCents: ['owner'], privateNote: ['owner'] },
    });
  });

  test('matrix cannot name a field the record lacks', () => {
    defineDisclosureMatrix<ExampleRecord>()({
      roles: ['owner'],
      // @ts-expect-error "ghost" is not a field of ExampleRecord
      fields: { id: [], title: [], sharedNote: [], amountCents: [], privateNote: [], internalScore: [], ghost: [] },
    });
  });

  test('matrix cannot name an undeclared role', () => {
    defineDisclosureMatrix<ExampleRecord>()({
      roles: ['owner'],
      fields: {
        id: ['owner'],
        title: ['owner'],
        sharedNote: ['owner'],
        amountCents: ['owner'],
        // @ts-expect-error "stranger" is not in roles
        privateNote: ['stranger'],
        internalScore: [],
      },
    });
  });

  test('roles list cannot repeat a role', () => {
    defineDisclosureMatrix<ExampleRecord>()({
      // @ts-expect-error duplicate role
      roles: ['owner', 'owner'],
      fields: { id: [], title: [], sharedNote: [], amountCents: [], privateNote: [], internalScore: [] },
    });
  });
});
