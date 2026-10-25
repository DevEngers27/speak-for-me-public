export { TemplateError, type TemplateErrorCode } from './errors.ts';
export { htmlEncoder, plainTextEncoder, type Encoder } from './encoders.ts';
export { createReferenceFormatters, type Formatters, type ReferenceFormatterOptions } from './formatters.ts';
export {
  isCalendarDate,
  slot,
  type AmountSlot,
  type DateSlot,
  type EnumSlot,
  type FragmentSlot,
  type IntegerSlot,
  type ListSlot,
  type SlotMap,
  type SlotSpec,
  type SlotValue,
  type TextSlot,
  type TokenSlot,
} from './slots.ts';
export {
  createRenderer,
  defineTemplate,
  emptyFragment,
  fragment,
  Fragment,
  isTemplate,
  type AnyTemplate,
  type CheckText,
  type EmptyFragment,
  type Exact,
  type Placeholders,
  type RenderContext,
  type Renderer,
  type SlotValues,
  type Template,
  type ValuesOf,
} from './template.ts';
