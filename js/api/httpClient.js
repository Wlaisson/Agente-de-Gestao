// Interceptor de window.fetch: injeta x-user-id/Authorization em toda chamada
// a /api/*. Portado verbatim (era duplicado byte-a-byte em index.html e
// usuarios.html); agora instalado uma vez por pagina via installAuthFetchInterceptor.
export function installAuthFetchInterceptor({ obterUsuarioLogado, obterSessaoAuth }) {
  const originalFetch = window.fetch;
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (url.includes('/api/')) {
      const user = obterUsuarioLogado();
      const session = obterSessaoAuth();
      const headers = new Headers(init.headers || (typeof input === 'object' && input.headers ? input.headers : {}));
      if (user && user.id && !headers.has('x-user-id')) {
        headers.set('x-user-id', user.id);
      }
      if (session && session.access_token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
      init.headers = headers;
    }
    return originalFetch.call(this, input, init);
  };
}
