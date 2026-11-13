import { approvalManager } from './approvalManager';

describe('approvalManager ownership', () => {
  it('lets only the owning user resolve an approval', async () => {
    const { id } = approvalManager.buildRequest('jobs_delete_job', {}, 'Delete a job');
    const decision = approvalManager.register(id, 'alice');

    expect(approvalManager.resolve(id, true, 'mallory')).toBe(false);
    expect(approvalManager.hasPending(id)).toBe(true);

    expect(approvalManager.resolve(id, true, 'alice')).toBe(true);
    await expect(decision).resolves.toBe(true);
    expect(approvalManager.hasPending(id)).toBe(false);
  });

  it('returns false for an unknown id', () => {
    expect(approvalManager.resolve('no-such-id', true, 'alice')).toBe(false);
  });
});
