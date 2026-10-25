import { it } from 'vitest';
import { schemaPrivacyCompleteness } from '../schema/privacyInventory';
it('TC-PRIV-10 schema leaves and derived DTO fields have their §7.9 audience and agent pair', schemaPrivacyCompleteness);
