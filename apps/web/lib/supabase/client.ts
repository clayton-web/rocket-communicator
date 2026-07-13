import { createBrowserClient } from '@supabase/ssr';
import { getPublicAuthConfig } from '@/lib/auth/config';

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getPublicAuthConfig();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
