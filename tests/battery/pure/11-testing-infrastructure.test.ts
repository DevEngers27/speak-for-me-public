import { describe, expect, it as vitestIt } from "vitest";
import { scanCanaries } from '../../convex-helpers/canary';
import {
  GOLDEN_ANCHOR,
  canaryFixture,
  canarySecrets,
  lintCanaries,
  materializeFixture,
  type CanarySecret,
} from "../../../core/scenarios/scope-change";

function ce163() {
  const mat = materializeFixture(canaryFixture, GOLDEN_ANCHOR);
  const secrets: readonly CanarySecret[] = [
    ...canarySecrets(mat.briefs.customer.hardFields.deadline),
    {
      id: "finance.pin.481731",
      ownerRole: "finance",
      allowedRoles: ["finance"],
      kind: "money",
      value: 481_731,
      origin: "constraint",
      provenance: "seeded",
    },
  ];
  // Substring inside _creationTime (e.g. 1730000481731 or 1730000512347) never false-positives
  expect(
    lintCanaries(secrets, [
      { label: "provider.ctx", text: '{"_creationTime":1730000481731,"other":1730000512347}' },
    ]),
  ).toEqual([]);
  // Standalone numeric pin 481731 or formatted "$4,817.31" is caught immediately
  const hitsRaw = lintCanaries(secrets, [{ label: "provider.ctx", text: '{"leak":481731}' }]);
  expect(hitsRaw.map((h) => h.secretId)).toEqual(["finance.pin.481731"]);
  const hitsUsd = lintCanaries(secrets, [{ label: "provider.ctx", text: "Cap is $4,817.31." }]);
  expect(hitsUsd.map((h) => h.secretId)).toEqual(["finance.pin.481731"]);
}

// W2-2 merge: retain both complete CE-163 assertion bodies under one registration.
function ce163Scan() {
    const pin = { id: 'pin', kind: 'money' as const, value: 481731, ownerRole: 'finance' as const, allowedRoles: [], origin: 'derived' as const, provenance: 'seeded' as const };
    expect(scanCanaries({ _creationTime: 1700481731000, at: 481731, cursor: '481731', roomId: '481731' }, [pin])).toEqual([]);
    expect(scanCanaries({ value: 'timestamp 1700481731000' }, [pin])).toEqual([]);
    expect(scanCanaries({ value: 481731 }, [pin])).toEqual([{ path: '$.value', secretId: 'pin' }]);
}
const implemented: Record<string, () => void> = {
  'CE-163': () => { ce163(); ce163Scan(); },
};
const it = { todo(title: string) {
  const body = implemented[title.split(' ')[0]!];
  if (body) vitestIt(title, body); else vitestIt.todo(title);
} };
// End W2-2 merge.

describe("P · 11-testing-infrastructure", () => {
  it.todo("CE-163 数值针脚 `481731` 命中 `_creationTime` 子串");
});
