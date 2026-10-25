// Neutral example record used only by tests. Field and role names are placeholders,
// not domain decisions; the real records and roles come from the design documents.
export const CANARY = 'CANARY-PRIVATE-7f3a91';

export interface ExampleRecord {
  id: string;
  title: string;
  sharedNote?: string;
  amountCents: number;
  privateNote: string;
  internalScore: number;
}

export type ExampleRole = 'owner' | 'peer' | 'auditor';

export function makeRecord(): ExampleRecord {
  return {
    id: 'rec_1',
    title: 'Example title',
    sharedNote: 'visible to owner and peer',
    amountCents: 123_45,
    privateNote: `owner only ${CANARY}`,
    internalScore: 987_654_321,
  };
}
