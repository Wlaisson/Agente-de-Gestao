import { mock } from 'node:test';
import { once } from 'node:events';
import { createSupabaseMock } from './supabaseMock.js';
import { createOpenAIMock } from './openaiMock.js';

// Boots the real server.js against mocked Supabase + OpenAI clients, on an
// ephemeral port. Requires running node with --experimental-test-module-mocks
// (see package.json "test" script) so mock.module can intercept the
// ../../supabaseClient.js and 'openai' imports before server.js pulls them
// in. No .env / real Supabase or OpenAI project is needed.
export async function startTestServer() {
  process.env.VERCEL = '1'; // stop server.js's own app.listen(port) from also binding
  process.env.OPENAI_API_KEY = 'test-key'; // makes infrastructure/openai/openaiClient.js create a (mocked) global client

  const supabaseAdmin = createSupabaseMock();
  const supabase = createSupabaseMock();
  const openai = createOpenAIMock();

  mock.module('../../supabaseClient.js', {
    namedExports: {
      supabaseAdmin: supabaseAdmin.client,
      supabase: supabase.client,
    }
  });

  mock.module('openai', {
    defaultExport: openai.OpenAIMock,
    namedExports: { toFile: openai.toFile }
  });

  const { default: app } = await import('../../server.js');

  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    supabaseAdmin,
    supabase,
    openai,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
