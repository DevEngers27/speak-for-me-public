import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AUDIENCE_VARIANTS,
  type AudienceVariant,
  createPublicTextRenderer,
  createRenderer,
  definePublicTemplate,
  definePublicTemplates,
  defineTemplate,
  formatUsdCents,
  Fragment,
  isAudienceVariant,
  isCalendarDate,
  isFragment,
  isoDate,
  type ItemKey,
  itemKey,
  type Placeholders,
  PUBLIC_TEMPLATES,
  publicCents,
  renderPublicText,
  slot,
  TemplateRenderError,
  trackReads,
} from './publicText';

describe('core/engine/publicText — audience variants & renderPublicText', () => {
  it('renders room, buyer, and owner variants deterministically', () => {
    const fields = {
      changedItemKeys: [itemKey('electrical_panel'), itemKey('hvac_duct')],
      severity: 'high' as const,
      effectiveDate: isoDate('2026-06-15'),
    };

    expect(renderPublicText('constraints_updated', fields)).toBe(
      'Updated constraints for electrical_panel and hvac_duct (high priority, effective 2026-06-15).',
    );
    expect(renderPublicText('constraints_updated', fields, 'room')).toBe(
      'Updated constraints for electrical_panel and hvac_duct (high priority, effective 2026-06-15).',
    );
    expect(renderPublicText('constraints_updated', fields, 'buyer')).toBe(
      'Counterparty updated constraints for electrical_panel and hvac_duct (high priority, effective 2026-06-15).',
    );
    expect(renderPublicText('constraints_updated', fields, 'owner')).toBe(
      'Your updated constraints for electrical_panel and hvac_duct (high priority, effective 2026-06-15) were shared.',
    );
  });

  it('renders proposal_summary and decision_recorded across all 3 audience variants', () => {
    const renderer = createPublicTextRenderer(PUBLIC_TEMPLATES);

    const proposalVariants = renderer.renderAllVariants('proposal_summary', {
      roundNumber: 2,
      status: 'active',
      totalPriceCents: publicCents(1_850_050),
      durationDays: 14,
      includedItemKeys: [
        itemKey('permit_fee'),
        itemKey('structural_beam'),
        itemKey('drywall_finish'),
      ],
    });

    expect(proposalVariants.room).toBe(
      'Round 2 proposal (active): $18,500.50 over 14 days covering permit_fee, structural_beam, and drywall_finish.',
    );
    expect(proposalVariants.buyer).toBe(
      'Round 2 offer to review (active): $18,500.50 over 14 days covering permit_fee, structural_beam, and drywall_finish.',
    );
    expect(proposalVariants.owner).toBe(
      'Round 2 proposal sent (active): $18,500.50 over 14 days covering permit_fee, structural_beam, and drywall_finish.',
    );

    const decisionVariants = renderer.renderAllVariants('decision_recorded', {
      roundNumber: 3,
      outcome: 'approve',
      approvedTotalCents: publicCents(1_800_000),
      decidedDate: isoDate('2026-07-01'),
    });

    expect(decisionVariants.room).toBe(
      'Round 3 decision (2026-07-01): approve at $18,000.',
    );
    expect(decisionVariants.buyer).toBe(
      'Round 3 counterparty decision (2026-07-01): approve at $18,000.',
    );
    expect(decisionVariants.owner).toBe(
      'Round 3 decision recorded (2026-07-01): approve at $18,000.',
    );
  });

  it('accepts a PublicTemplateDefinition or definePublicTemplates catalog directly in renderPublicText', () => {
    const customCatalog = definePublicTemplates({
      custom_round_notice: {
        reads: ['roundNumber'],
        slots: {
          roundNumber: slot.integer({ min: 1, max: 10 }),
        },
        variants: {
          room: 'Round {roundNumber} opened.',
          buyer: 'Round {roundNumber} awaits buyer response.',
          owner: 'Round {roundNumber} awaits owner review.',
        },
      },
    });
    const custom = definePublicTemplate('custom_round_notice', {
      reads: ['roundNumber'],
      slots: {
        roundNumber: slot.integer({ min: 1, max: 10 }),
      },
      variants: {
        room: 'Round {roundNumber} opened.',
        buyer: 'Round {roundNumber} awaits buyer response.',
        owner: 'Round {roundNumber} awaits owner review.',
      },
    });

    expect(renderPublicText(customCatalog.custom_round_notice, { roundNumber: 4 }, 'room')).toBe(
      'Round 4 opened.',
    );
    expect(renderPublicText(custom, { roundNumber: 4 }, 'buyer')).toBe(
      'Round 4 awaits buyer response.',
    );
    expect(isAudienceVariant('room')).toBe(true);
    expect(isAudienceVariant('buyer')).toBe(true);
    expect(isAudienceVariant('owner')).toBe(true);
    expect(isAudienceVariant('admin')).toBe(false);
  });

  it('rejects unknown template keys and unknown audience variants at runtime', () => {
    expect(() =>
      renderPublicText('nonexistent_key' as never, {} as never),
    ).toThrowError(TemplateRenderError);

    expect(() =>
      renderPublicText(
        'decision_recorded',
        {
          roundNumber: 1,
          outcome: 'approve',
          approvedTotalCents: publicCents(100),
          decidedDate: isoDate('2026-05-01'),
        },
        'leaked_audience' as AudienceVariant,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNKNOWN_AUDIENCE_VARIANT',
      }),
    );
  });

  it('forbids free-text slots (slot.text) in public templates at compile time and runtime', () => {
    expect(() =>
      definePublicTemplate('unsafe_public', {
        slots: {
          // @ts-expect-error — slot.text is forbidden in PublicSlotRecord
          freeNote: slot.text({ maxLength: 80 }),
        },
        variants: {
          room: 'Note: {freeNote}',
          buyer: 'Note: {freeNote}',
          owner: 'Note: {freeNote}',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'DISALLOWED_PUBLIC_SLOT_KIND',
        slot: 'freeNote',
      }),
    );
  });
});

describe('core/engine/publicText — Proxy read-tracking & canary safety', () => {
  it('only reads declared `reads` fields and never touches private sibling fields on a Proxy', () => {
    const fullStateWithCanaries = {
      // Public declared fields:
      roundNumber: 2,
      status: 'active' as const,
      totalPriceCents: publicCents(450_000),
      durationDays: 7,
      includedItemKeys: [itemKey('cabinetry'), itemKey('tile_backsplash')],
      // Private canary fields that MUST NEVER be read:
      reservationPriceCents: 390_000,
      maxBudgetCents: 500_000,
      internalReasoning: 'CANARY_PRIVATE_REASONING_991',
      privateNotes: 'CANARY_OWNER_FLOOR_390K',
      deferredItemKeys: ['lighting_upgrade'],
    };

    for (const key of Object.keys(PUBLIC_TEMPLATES) as Array<
      keyof typeof PUBLIC_TEMPLATES
    >) {
      const def = PUBLIC_TEMPLATES[key];
      const sampleState = {
        ...fullStateWithCanaries,
        changedItemKeys: [itemKey('cabinetry')],
        severity: 'medium' as const,
        effectiveDate: isoDate('2026-08-01'),
        outcome: 'approve' as const,
        approvedTotalCents: publicCents(450_000),
        decidedDate: isoDate('2026-08-02'),
      };

      for (const variant of AUDIENCE_VARIANTS) {
        const { result, accessedKeys } = trackReads(
          sampleState,
          def.reads,
          (proxied) => renderPublicText(key, proxied as never, variant),
        );

        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toContain('CANARY');
        expect(result).not.toContain('390');
        expect(result).not.toContain('lighting_upgrade');
        for (const k of accessedKeys) {
          expect(def.reads).toContain(k);
        }
      }
    }
  });

  it('trackReads throws UNDECLARED_READ_KEY if a function touches a non-whitelisted property or enumerates keys', () => {
    const state = {
      roundNumber: 1,
      secretFloorCents: 100_000,
    };

    expect(() =>
      trackReads(state, ['roundNumber'], (proxied) => proxied.secretFloorCents),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNDECLARED_READ_KEY',
        slot: 'secretFloorCents',
      }),
    );

    expect(() =>
      trackReads(state, ['roundNumber'], (proxied) => Object.keys(proxied)),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNDECLARED_READ_KEY',
      }),
    );
  });
});

describe('core/engine/publicText — REVIEW item regressions (r01..r10)', () => {
  it('r01: slot.token rejects multiline (m), global (g), and sticky (y) regex flags', () => {
    expect(() => slot.token(/^[a-z]+$/m)).toThrow(RangeError);
    expect(() => slot.token(/^[a-z]+$/g)).toThrow(RangeError);
    expect(() => slot.token(/^[a-z]+$/y)).toThrow(RangeError);
    expect(() => slot.token(/[a-z]+/)).toThrow(RangeError);
  });

  it('r02: Fragment is tamper-proof and cannot be forged or mutated after validation', () => {
    const childDef = defineTemplate(
      'child_frag',
      'item {code}',
      {
        code: slot.token<ItemKey>(),
      },
    );
    const parentDef = defineTemplate(
      'parent_frag',
      'Summary: {detail}.',
      {
        detail: slot.fragment(['child_frag']),
      },
    );
    const cat = createRenderer({
      child_frag: childDef,
      parent_frag: parentDef,
    });

    const frag = cat.renderFragment('child_frag', {
      code: itemKey('roof_flashing'),
    });
    expect(isFragment(frag)).toBe(true);
    expect(frag.text).toBe('item roof_flashing');
    expect(frag.parts.canonical.code).toBe('roof_flashing');

    // Attempt to mutate parts.canonical or fragment properties fails
    expect(() => {
      (frag.parts.canonical as Record<string, string>).code = 'LEAKED';
    }).toThrow(TypeError);
    expect(() => {
      (frag as unknown as Record<string, unknown>).text = 'LEAKED';
    }).toThrow(TypeError);

    // Attempt to construct a forged Fragment via Object.create or direct constructor fails
    const fakeFrag = Object.create(Fragment.prototype) as Fragment;
    expect(isFragment(fakeFrag)).toBe(false);
    expect(() =>
      cat.render('parent_frag', { detail: fakeFrag }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_SLOT_VALUE',
        slot: 'detail',
      }),
    );
  });

  it('r03 & r05: rejects lone surrogates, soft hyphens, invisible operators, Hangul fillers, and variation selectors without ES2024 isWellFormed', () => {
    const labelDef = defineTemplate(
      'bounded_label',
      'Label: {title}',
      {
        title: slot.text({ minLength: 1, maxLength: 40 }),
      },
    );
    const renderer = createRenderer({ bounded_label: labelDef });

    const forbiddenSamples = [
      'bad\uD800surrogate', // lone high surrogate
      'bad\uDC00surrogate', // lone low surrogate
      'soft\u00ADhyphen', // U+00AD
      'cgj\u034Fchar', // U+034F
      'hangul\u115Ffiller', // U+115F
      'hangul\u3164filler', // U+3164
      'hangul\uFFA0halfwidth', // U+FFA0
      'invisible\u2062times', // U+2062
      'variation\uFE0Fselector', // U+FE0F
      'supp\u{E0100}vs', // U+E0100
      'bidi\u202Eoverride', // U+202E
      'line\nbreak', // newline
    ];

    for (const bad of forbiddenSamples) {
      expect(() =>
        renderer.render('bounded_label', { title: bad }),
      ).toThrowError(
        expect.objectContaining({
          code: 'INVALID_SLOT_VALUE',
          slot: 'title',
        }),
      );
    }
  });

  it('r07: Placeholders<T> handles templates with many placeholders via tail recursion', () => {
    type Many = Placeholders<'{a}-{b}-{c}-{d}-{e}-{f}-{g}-{h}-{i}-{j}-{k}-{l}'>;
    expectTypeOf<Many>().toEqualTypeOf<
      'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l'
    >();
  });

  it('r08: slot.enum rejects numeric-like keys at definition time', () => {
    expect(() =>
      slot.enum({
        '0': 'zero',
        '1': 'one',
      }),
    ).toThrow(RangeError);
  });

  it('r09: slot.list snapshots array length once and cannot be tricked by a stateful length/element getter', () => {
    const listSlot = slot.list(slot.token(), { minItems: 1, maxItems: 2 });
    let lengthCalls = 0;
    const trickyArray = new Proxy([itemKey('first_item')], {
      get(target, prop, receiver) {
        if (prop === 'length') {
          lengthCalls += 1;
          return lengthCalls === 1 ? 1 : 99;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const out = listSlot.render(trickyArray, {
      templateId: 'test',
      slotName: 'items',
    });
    expect(out).toBe('first_item');
    expect(lengthCalls).toBe(1);
  });

  it('r10: template literals containing bidi/control characters are rejected at definition time', () => {
    expect(() =>
      defineTemplate('bad_lit', 'Hello \u202E world', {}),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_TEMPLATE_SYNTAX',
      }),
    );
  });
});

describe('core/engine/publicText — scalar validators & template syntax checks', () => {
  it('validates USD cents formatting and bounds', () => {
    expect(formatUsdCents(0)).toBe('$0');
    expect(formatUsdCents(5)).toBe('$0.05');
    expect(formatUsdCents(100)).toBe('$1');
    expect(formatUsdCents(123_456)).toBe('$1,234.56');
    expect(formatUsdCents(100_000_000)).toBe('$1,000,000');

    expect(() => publicCents(-1)).toThrow();
    expect(() => publicCents(12.34)).toThrow();
    expect(() => publicCents(Number.NaN)).toThrow();
  });

  it('validates Gregorian calendar dates including leap years', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('1900-02-29')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(() => isoDate('2026-02-29')).toThrow(RangeError);
  });

  it('rejects malformed brace syntax and slot/placeholder mismatches', () => {
    expect(() => defineTemplate('unclosed', 'Hello {name', {} as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TEMPLATE_SYNTAX' }),
    );
    expect(() => defineTemplate('unmatched', 'Hello }name{', {} as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TEMPLATE_SYNTAX' }),
    );
    expect(() =>
      defineTemplate('missing_slot', 'Hello {name}', {} as never),
    ).toThrowError(
      expect.objectContaining({ code: 'TEMPLATE_SLOT_MISMATCH' }),
    );
    expect(() =>
      defineTemplate('extra_slot', 'Hello', {
        extra: slot.integer({ min: 0, max: 1 }),
      } as never),
    ).toThrowError(
      expect.objectContaining({ code: 'TEMPLATE_SLOT_MISMATCH' }),
    );
  });

  it('evaluates repeated placeholders once per render call', () => {
    const repeated = defineTemplate(
      'repeat_slot',
      '{code} -> {code}',
      {
        code: slot.token(),
      },
    );
    const renderer = createRenderer({ repeat_slot: repeated });
    let getterCount = 0;
    const params = {
      get code() {
        getterCount += 1;
        return itemKey('alpha_1');
      },
    };
    expect(renderer.render('repeat_slot', params)).toBe('alpha_1 -> alpha_1');
    expect(getterCount).toBe(1);
  });
});

describe('wave-0 public text guards', () => {
  it('rejects open token regexes and never echoes rejected private values', () => {
    expect(() => slot.token(/^.*$/)).toThrow();
    for (const fail of [() => publicCents(100_000_000_001), () => isoDate('PRIVATE_CANARY'), () => itemKey('PRIVATE_CANARY!')]) {
      expect(fail).toThrow();
      try { fail(); } catch (error) {
        expect(String(error)).not.toContain('PRIVATE_CANARY');
        expect(String(error)).not.toContain('100000000001');
      }
    }
    expect(() => formatUsdCents(-1)).toThrow();
    expect(isoDate('0000-01-01')).toBe('0000-01-01');
    expect(isoDate('9999-12-31')).toBe('9999-12-31');
  });
});
