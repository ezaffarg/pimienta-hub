import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serverClient: SupabaseClient | undefined;

function getRequiredEnvironmentVariable(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function getSupabaseServerClient(): SupabaseClient {
  if (!serverClient) {
    serverClient = createClient(
      getRequiredEnvironmentVariable('SUPABASE_URL'),
      getRequiredEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }

  return serverClient;
}
