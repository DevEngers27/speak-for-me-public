import { retrieveConfiguredModel, classifyError, NEGOTIATION_MODEL } from './modelGateway';
export { NEGOTIATION_MODEL };
export type RetrieveFailure = 'auth' | 'model_not_found' | 'transport';
/** Uses the gateway's HTTP transport and closed error classification. */
export async function retrieveModel(model: string, apiKey: string | undefined): Promise<{ ok: true } | { ok: false; code: RetrieveFailure }> {
  if (!apiKey?.trim()) return { ok: false, code: 'auth' };
  try {
    await retrieveConfiguredModel(model, apiKey);
    return { ok: true };
  } catch (error) {
    const classified = classifyError(error);
    return { ok: false, code: classified.errorCode === 'auth' ? 'auth' : classified.errorCode === 'model_not_found' ? 'model_not_found' : 'transport' };
  }
}
