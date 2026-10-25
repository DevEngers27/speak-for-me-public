export type ConstraintWriteViolation = { file: string; line: number; kind: 'immutable-constraint-write' | 'unauthorized-bump'; field?: string; caller?: string };
export function findConstraintWriteViolations(filePath: string, source: string): ConstraintWriteViolation[];
