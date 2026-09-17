import { mock } from 'node:test';
import { once } from 'node:events';
import { createSupabaseMock } from './supabaseMock.js';

// Boots the real server.js against mocked Supabase clients, on an ephemeral port.
// Requires running node with --experimental-test-module-mocks (see package.json
// "test" script) so mock.module can intercept the ../../supabaseClient.js import
// before server.js pulls it in. No .env / real Supabase project is needed.
export async function startTestServer() {
  process.env.VERCEL = '1'; // stop server.js's own app.listen(port) from also binding

  const supabaseAdmin = createSupabaseMock();
  const supabase = createSupabaseMock();

  mock.module('../../supabaseClient.js', {
    namedExports: {
      supabaseAdmin: supabaseAdmin.client,
      supabase: supabase.client,
    }
  });

  const { default: app } = await import('../../server.js');

  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    supabaseAdmin,
    supabase,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
