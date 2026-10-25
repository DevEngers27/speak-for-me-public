import { describe, it as vitestIt } from "vitest";

// W2-4: runtime contracts retain the registry titles below.
import { runtimePureCases } from '../../engine/runtimeBattery';
const implemented: Record<string, () => void> = {
  'INV-55': runtimePureCases['INV-55']!,
};
const it = { todo(title: string) { const body = implemented[title.split(' ')[0]!]; if (body) vitestIt(title, body); else vitestIt.todo(title); } };
// End W2-4.

describe("P · 06-append-only-history", () => {
  it.todo("INV-55 `proposals.termsKey = canonicalJson(terms)`（键序无关，不用 sha256），插入后不变；`proposals.version` 房间内单调（`rooms.nextProposalVersion` 在同一 mutation 先读后 +1），不因新 run 重置、不因 bump 递增；被守卫拒收的回合与被规则阻断的候选都不插提案、不消耗版本号；新 run 总是插入自己的提案版本（条款与 vN 相同时只在界面标注），例外只有 INV-32(a) 对同一 proposalId 重批与 `choose_candidate` 复用本 run 当前仍通过的提案");
});
