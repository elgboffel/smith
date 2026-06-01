import { describe, it, expect } from 'bun:test';
import { gitPolicyForMode } from '../entry/git-policy.js';

describe('gitPolicyForMode', () => {
  it('direct dispatch makes zero git writes', () => {
    const policy = gitPolicyForMode('direct');
    expect(policy.createsBranch).toBe(false);
    expect(policy.ensuresIgnored).toBe(false);
    expect(policy.commits).toBe(false);
  });

  it('legacy modes keep the managed git behaviour', () => {
    for (const mode of ['github', 'linear', 'freeform'] as const) {
      const policy = gitPolicyForMode(mode);
      expect(policy.createsBranch).toBe(true);
      expect(policy.ensuresIgnored).toBe(true);
      expect(policy.commits).toBe(true);
    }
  });
});
