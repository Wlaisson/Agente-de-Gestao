// Characterization tests for the auth + admin-users routes (server.js lines
// ~377-489). These pin down CURRENT behavior (including its quirks, e.g. no
// JWT verification on x-user-id) before Phase 1 rewires verificarAdmin to
// import from middleware/verificarAdmin.js instead of using the inline
// duplicate. Re-run after Phase 1 and diff: results must be identical.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { findCallArgs, calledWith } from './helpers/supabaseMock.js';

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

function usuariosTable({ admins = {}, list = [] } = {}) {
  return (table, calls) => {
    if (table !== 'usuarios') return { data: null, error: null };
    if (calledWith(calls, 'insert')) {
      const [row] = findCallArgs(calls, 'insert');
      return { data: row, error: null };
    }
    if (calledWith(calls, 'delete')) {
      return { data: null, error: null };
    }
    if (calledWith(calls, 'single')) {
      const [, id] = findCallArgs(calls, 'eq') || [];
      const usuario = admins[id];
      return usuario
        ? { data: usuario, error: null }
        : { data: null, error: { message: 'not found' } };
    }
    return { data: list, error: null };
  };
}

test('GET /api/admin/usuarios sem x-user-id -> 403', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios`);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /Acesso negado/);
});

test('GET /api/admin/usuarios com usuario nao-admin -> 403', async () => {
  ctx.supabaseAdmin.setFromHandler(usuariosTable({
    admins: { 'user-1': { id: 'user-1', is_admin: false } }
  }));
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios`, {
    headers: { 'x-user-id': 'user-1' }
  });
  assert.equal(res.status, 403);
});

test('GET /api/admin/usuarios com admin -> 200 + lista', async () => {
  const lista = [{ id: 'admin-1', email: 'a@a.com', nome: 'Admin', is_admin: true, permissoes: {}, created_at: '2024-01-01' }];
  ctx.supabaseAdmin.setFromHandler(usuariosTable({
    admins: { 'admin-1': { id: 'admin-1', is_admin: true } },
    list: lista
  }));
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios`, {
    headers: { 'x-user-id': 'admin-1' }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.deepEqual(body.data, lista);
});

test('POST /api/admin/usuarios sem email/senha -> 400', async () => {
  ctx.supabaseAdmin.setFromHandler(usuariosTable({
    admins: { 'admin-1': { id: 'admin-1', is_admin: true } }
  }));
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios`, {
    method: 'POST',
    headers: { 'x-user-id': 'admin-1', 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('POST /api/admin/usuarios sucesso -> 200 status success', async () => {
  ctx.supabaseAdmin.setFromHandler(usuariosTable({
    admins: { 'admin-1': { id: 'admin-1', is_admin: true } }
  }));
  ctx.supabaseAdmin.setAuthAdmin({
    createUser: async ({ email }) => ({ data: { user: { id: 'new-1', email } }, error: null }),
    deleteUser: async () => ({ data: {}, error: null }),
  });
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios`, {
    method: 'POST',
    headers: { 'x-user-id': 'admin-1', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'novo@teste.com', password: 'Senha@123', nome: 'Novo' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.user.email, 'novo@teste.com');
});

test('POST /api/admin/usuarios: falha ao inserir em usuarios -> compensa deletando o auth user criado', async () => {
  let deletedId = null;
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (table !== 'usuarios') return { data: null, error: null };
    if (calledWith(calls, 'single')) {
      // verificarAdmin's own lookup for the requesting admin user.
      return { data: { id: 'admin-1', is_admin: true }, error: null };
    }
    if (calledWith(calls, 'insert')) {
      return { data: null, error: { message: 'insert falhou' } };
    }
    return { data: null, error: null };
  });
  ctx.supabaseAdmin.setAuthAdmin({
    createUser: async ({ email }) => ({ data: { user: { id: 'new-2', email } }, error: null }),
    deleteUser: async (id) => { deletedId = id; return { data: {}, error: null }; },
  });
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios`, {
    method: 'POST',
    headers: { 'x-user-id': 'admin-1', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@x.com', password: 'Senha@123' })
  });
  assert.equal(res.status, 500);
  assert.equal(deletedId, 'new-2');
});

test('DELETE /api/admin/usuarios/:id -> 200 status success', async () => {
  ctx.supabaseAdmin.setFromHandler(usuariosTable({
    admins: { 'admin-1': { id: 'admin-1', is_admin: true } }
  }));
  ctx.supabaseAdmin.setAuthAdmin({
    deleteUser: async () => ({ data: {}, error: null }),
  });
  const res = await fetch(`${ctx.baseUrl}/api/admin/usuarios/user-5`, {
    method: 'DELETE',
    headers: { 'x-user-id': 'admin-1' }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
});

test('POST /api/auth/login sem email/senha -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('POST /api/auth/login credenciais invalidas -> 401', async () => {
  ctx.supabase.setAuthClient({
    signInWithPassword: async () => ({ data: { user: null }, error: { message: 'Credenciais inválidas.' } })
  });
  const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.com', password: 'errada' })
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/login: autenticado no Supabase Auth mas sem linha em usuarios -> 403', async () => {
  ctx.supabase.setAuthClient({
    signInWithPassword: async () => ({
      data: { user: { id: 'auth-1' }, session: { access_token: 'tok' } },
      error: null
    })
  });
  ctx.supabaseAdmin.setFromHandler(usuariosTable({ admins: {} }));
  const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.com', password: 'certa' })
  });
  assert.equal(res.status, 403);
});

test('POST /api/auth/login sucesso -> 200 com session + user', async () => {
  ctx.supabase.setAuthClient({
    signInWithPassword: async () => ({
      data: { user: { id: 'auth-1' }, session: { access_token: 'tok' } },
      error: null
    })
  });
  ctx.supabaseAdmin.setFromHandler(usuariosTable({
    admins: { 'auth-1': { id: 'auth-1', email: 'a@a.com', nome: 'A', is_admin: false, permissoes: {} } }
  }));
  const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.com', password: 'certa' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.user.id, 'auth-1');
  assert.equal(body.session.access_token, 'tok');
});
