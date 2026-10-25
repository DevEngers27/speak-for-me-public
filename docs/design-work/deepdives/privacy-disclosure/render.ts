// 设计草案：模板渲染。参数类型封闭，没有任意 string；渲染前先按查看者投影参数。
import type { Audience, Viewer } from './disclosure';
import { canSee } from './disclosure';

type Cents = number & { readonly __cents: true };       // 只能由代码计算产生
type IsoDate = string & { readonly __isoDate: true };
type ItemKey = string & { readonly __itemKey: true };   // /^[A-Z][A-Z0-9_]{1,31}$/
type ParamValue =
  | { t: 'cents'; v: Cents } | { t: 'date'; v: IsoDate } | { t: 'itemKeys'; v: ItemKey[] }
  | { t: 'role'; v: string } | { t: 'reasonCodes'; v: string[] } | { t: 'version'; v: number }
  | { t: 'count'; v: number };
export type TemplateParams = Record<string, { value: ParamValue; audience: Audience; ownerRole?: string }>;
type Visible = Record<string, ParamValue | undefined>;

export type Template = { room: (p: Visible) => string; buyer?: (p: Visible) => string };

export function renderTemplate(t: Template, params: TemplateParams, v: Viewer, isBuyer: boolean): string {
  const visible: Visible = {};
  for (const [k, p] of Object.entries(params)) {
    visible[k] = canSee(v, p.audience, p.ownerRole) ? p.value : undefined;   // 模板拿不到无权参数
  }
  return (isBuyer && t.buyer ? t.buyer : t.room)(visible);
}

// 例：proposal_blocked（场景模板）
export const proposalBlocked: Template = {
  room: p => `v${val(p.version)} (+${money(p.amount)}) is blocked: ${reasons(p.reasons)}.`,
  buyer: p => p.afterApproval && p.cap && p.overBy
    ? `v${val(p.version)} (+${money(p.amount)}) is blocked: ${money(p.afterApproval)} committed after approval exceeds the ${money(p.cap)} cap by ${money(p.overBy)}.`
    : proposalBlocked.room(p),
};
declare function val(p?: ParamValue): string;
declare function money(p?: ParamValue): string;     // formatCents(integer, currency)
declare function reasons(p?: ParamValue): string;   // reasonCode → 固定英文短语，exceeds_budget → "exceeds the finance limit"
