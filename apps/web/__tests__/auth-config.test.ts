import { afterEach, describe, expect, it } from 'vitest';
import { AuthConfigError, getAuthConfig } from '@/lib/auth/config';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('auth config', () => {
  it('requires all configuration values', () => {
    delete process.env.OWNER_ORGANIZATION_ID;
    expect(() => getAuthConfig()).toThrow(AuthConfigError);
    expect(() => getAuthConfig()).toThrow(/OWNER_ORGANIZATION_ID/);
  });

  it('returns configured organization id separately from workspace domain', () => {
    process.env.OWNER_ORGANIZATION_ID = 'org_explicit_value';
    process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
    const config = getAuthConfig();
    expect(config.ownerOrganizationId).toBe('org_explicit_value');
    expect(config.ownerWorkspaceDomain).toBe('example.com');
  });
});
