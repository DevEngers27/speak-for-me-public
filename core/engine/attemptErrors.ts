export const ATTEMPT_ERROR_CODES = [
  'transport',
  'model_timeout',
  'watchdog_timeout',
  'action_crashed',
  'bad_request',
  'auth',
  'quota_exhausted',
  'model_not_found',
  'context_overflow',
  'unexpected_stop',
  'api_error',
  'agents_disabled',
  'config_invalid',
  'internal',
] as const;
export type AttemptErrorCode = (typeof ATTEMPT_ERROR_CODES)[number];
