import {
  assertWhitelisted,
  buildRequest,
  type BuildRequestInput,
  type WhitelistedRequestBody,
} from '../../convex/model/agents/modelGateway';

/** Negative-test builder only: production request construction has no override seam. */
export function buildRequestForTest(
  input: BuildRequestInput & {
    readonly extraBody?: Readonly<Record<string, unknown>>;
  },
): WhitelistedRequestBody {
  const { extraBody, ...canonical } = input;
  const candidate = { ...buildRequest(canonical), ...extraBody };
  assertWhitelisted(candidate);
  return Object.freeze(candidate);
}
