process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
process.env.OWNER_ORGANIZATION_ID = 'org_test_123';
// A5.3 Gmail OAuth (test-only; never real credentials).
process.env.GOOGLE_GMAIL_CLIENT_ID = 'test-gmail-client-id.apps.googleusercontent.com';
process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'test-gmail-client-secret';
process.env.GMAIL_TOKEN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GMAIL_TOKEN_ENCRYPTION_KEY_VERSION = '1';
