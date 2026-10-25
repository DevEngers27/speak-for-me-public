import { expect, expectTypeOf } from 'vitest';
import {
  publicText,
  wrapCatalogTitle,
  verifyUntrustedBlock,
} from '../../core/engine';
import {
  DISCLOSURE,
  projectForRole,
  ROLES,
  type Family,
} from './privacyDisclosure';
import { initialState, projectPrivacyState } from './privacyPipeline';

/** INV-05 covers the template type/runtime boundary and every public projection family. */
export function publicStringChecks() {
  const { definePublicTemplate, renderPublicText, slot, PUBLIC_TEMPLATES } =
    publicText;
  expectTypeOf<
    Extract<publicText.PublicAllowedSlotKind, 'text'>
  >().toEqualTypeOf<never>();
  expect(() =>
    definePublicTemplate('unsafe', {
      slots: {
        // @ts-expect-error Free strings cannot be supplied as public template slots.
        note: slot.text({ maxLength: 80 }),
      },
      variants: { room: '{note}', buyer: '{note}', owner: '{note}' },
    }),
  ).toThrow(expect.objectContaining({ code: 'DISALLOWED_PUBLIC_SLOT_KIND' }));
  for (const template of Object.values(PUBLIC_TEMPLATES)) {
    for (const spec of Object.values(template.slots))
      expect(spec.kind).not.toBe('text');
  }
  const template = definePublicTemplate('public_progress', {
    slots: { round: slot.integer({ min: 1, max: 5 }) },
    variants: {
      room: 'Round {round}',
      buyer: 'Round {round}',
      owner: 'Round {round}',
    },
  });
  const canary = 'PRIVATE_MODEL_RATIONALE';
  const fields = {
    round: 2,
    rationale: canary,
    publicRationale: canary,
    publicSummary: canary,
  };
  for (const audience of ['room', 'buyer', 'owner'] as const) {
    expect(renderPublicText(template, fields, audience)).toBe('Round 2');
  }
  expect(() =>
    renderPublicText(template, { round: canary } as never),
  ).toThrow();
  for (const title of ['', '<', '>', 'a\rb', 'a\nb', 'x'.repeat(81)])
    expect(() => wrapCatalogTitle(title)).toThrow();
  expect(verifyUntrustedBlock(wrapCatalogTitle('Safe & title').block).ok).toBe(
    true,
  );
  for (const role of ROLES) {
    for (const family of Object.keys(DISCLOSURE) as Family[]) {
      const projected = projectForRole(role, {
        family,
        data: {
          role: role === 'provider' ? 'customer' : 'provider',
          publicRationale: canary,
          publicSummary: canary,
          rationale: canary,
        },
      });
      expect(JSON.stringify(projected) ?? '').not.toContain(canary);
      expect(Object.keys(DISCLOSURE[family])).not.toEqual(
        expect.arrayContaining(['publicRationale']),
      );
      expect(Object.keys(DISCLOSURE[family])).not.toEqual(
        expect.arrayContaining(['publicSummary']),
      );
    }
    const boundary = projectPrivacyState(role, {
      ...initialState,
      providerNotes: canary,
      customerNotes: canary,
      financeNotes: canary,
    });
    const visible = JSON.stringify({
      events: boundary.events,
      context: { ...boundary.context, principal: undefined },
    });
    expect(visible).not.toMatch(/publicRationale|publicSummary/);
    expect(visible).not.toContain(canary);
  }
}
