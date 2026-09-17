// Helpers de sessao/localStorage compartilhados entre index.html e usuarios.html.
// Portados verbatim do script inline de index.html (comportamento identico).
export function obterUsuarioLogado() {
  try {
    const raw = localStorage.getItem('auth_user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function obterSessaoAuth() {
  try {
    const raw = localStorage.getItem('auth_session');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function salvarAutenticacao(session, user) {
  localStorage.setItem('auth_session', JSON.stringify(session));
  localStorage.setItem('auth_user', JSON.stringify(user));
}

export function limparAutenticacao() {
  localStorage.removeItem('auth_session');
  localStorage.removeItem('auth_user');
}
