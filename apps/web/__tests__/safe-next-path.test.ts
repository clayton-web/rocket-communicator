import { describe, expect, it } from 'vitest';
import { resolveSafeNextPath } from '@/lib/auth/safe-next-path';

describe('resolveSafeNextPath', () => {
  it('allows Task return paths', () => {
    expect(resolveSafeNextPath('/tasks/task_1')).toBe('/tasks/task_1');
  });

  it('rejects open redirects', () => {
    expect(resolveSafeNextPath('https://evil.example')).toBe('/');
    expect(resolveSafeNextPath('//evil.example')).toBe('/');
    expect(resolveSafeNextPath('/\\evil')).toBe('/');
    expect(resolveSafeNextPath('/tasks:foo')).toBe('/');
  });
});
