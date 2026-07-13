import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthConfigError, getAuthConfig, getPublicAuthConfig } from '@/lib/auth/config';

const ORIGINAL_ENV = { ...process.env };
const configSourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../lib/auth/config.ts',
);

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

  it('returns public auth config from statically referenced NEXT_PUBLIC variables', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000/';

    const config = getPublicAuthConfig();
    expect(config).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'public-anon-key',
      appUrl: 'http://localhost:3000',
    });
  });

  it('throws AuthConfigError when a NEXT_PUBLIC variable is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => getPublicAuthConfig()).toThrow(AuthConfigError);
    expect(() => getPublicAuthConfig()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('does not use dynamic process.env lookup for public configuration', () => {
    const source = readFileSync(configSourcePath, 'utf8');
    const publicConfigBlock = source.slice(
      source.indexOf('export function getPublicAuthConfig'),
      source.indexOf('export function getAuthConfig'),
    );

    expect(publicConfigBlock).not.toMatch(/process\.env\[/);
    expect(publicConfigBlock).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
    expect(publicConfigBlock).toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(publicConfigBlock).toContain('process.env.NEXT_PUBLIC_APP_URL');
  });
});
