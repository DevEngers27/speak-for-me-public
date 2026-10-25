import { expect, it } from 'vitest';
import { defineScenario, privacy } from '../../../core/engine';
import { plugin } from './fixture';
it.each(['customer', 'provider', 'finance'])('D12-3 registration rejects option_fits_constraints asked by %s', role => {
  expect(() => defineScenario({ ...plugin, protocol: { ...plugin.protocol, topics: [{ topicKey: 'option_fits_constraints', field: 'deadline', answer: 'human', questionTemplateKey: 'clarify_deadline', toRole: role === 'customer' ? 'provider' : 'customer', askableBy: [role] }] } })).toThrow('Invalid topics');
});

it('06-12.1 member 18 default is human reasonKeys with audience room', () => {
  const defaulted = defineScenario({ ...plugin, humanReasonKeys: undefined, protocol: { ...plugin.protocol, reasonKeys: [
    { reasonKey: 'human_choice', usableBy: ['human'] },
    { reasonKey: 'agent_choice', usableBy: ['customer'] },
  ] } });
  for (const viewer of ['customer', 'provider', 'finance'] as const) {
    expect(privacy.projectForRole(viewer, { family: 'approvals', data: { role: 'customer', reasonKey: 'human_choice' } }, { plugin: defaulted })).toMatchObject({ reasonKey: 'human_choice' });
    expect(privacy.projectForRole(viewer, { family: 'approvals', data: { role: 'customer', reasonKey: 'agent_choice' } }, { plugin: defaulted })).toMatchObject({ reasonKey: null });
  }
});
