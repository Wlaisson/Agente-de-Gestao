import { obterUsuarioLogado, obterSessaoAuth, limparAutenticacao } from '../features/auth.js';
import { installAuthFetchInterceptor } from '../api/httpClient.js';
import { toggleSidebar } from '../ui/sidebar.js';
import { createAdminUsersModule } from '../features/admin-users.js';
import { criarMostrarToast } from '../ui/toast.js';

installAuthFetchInterceptor({ obterUsuarioLogado, obterSessaoAuth });

// usuarios.html nunca teve o registro de icones (APP_SVG_ICONS) que
// index.html usa, entao nao passa resolverIcone; a duracao de saida de
// 300ms (index.html usa 350ms) e o timing original desta pagina, preservado.
const mostrarToast = criarMostrarToast({ duracaoSaidaMs: 300 });

function sairDoSistema() {
  limparAutenticacao();
  window.location.href = 'index.html';
}

const adminUsers = createAdminUsersModule({ mostrarToast, obterUsuarioLogado });

// <script type="module"> nao expoe bindings de topo em `window`; esta pagina usa
// atributos onclick/onsubmit inline que o navegador resolve contra o escopo
// global. Ponte explicita e mecanica - nenhuma logica muda.
window.toggleSidebar = toggleSidebar;
window.sairDoSistema = sairDoSistema;
window.abrirModalNovoUsuario = adminUsers.abrirModalNovoUsuario;
window.fecharModalNovoUsuario = adminUsers.fecharModalNovoUsuario;
window.marcarTodasPermissoes = adminUsers.marcarTodasPermissoes;
window.salvarNovoUsuario = adminUsers.salvarNovoUsuario;
window.excluirUsuarioAdmin = adminUsers.excluirUsuarioAdmin;
window.carregarListaUsuariosAdmin = adminUsers.carregarListaUsuariosAdmin;

window.addEventListener('DOMContentLoaded', () => {
  const user = obterUsuarioLogado();
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-user-avatar');
  if (nameEl) nameEl.textContent = user.nome || user.email;
  if (roleEl) roleEl.textContent = user.is_admin ? 'Administrador' : 'Membro';
  if (avatarEl) {
    const n = user.nome || user.email;
    avatarEl.textContent = n.substring(0, 2).toUpperCase();
  }
  if (!user.is_admin) {
    alert('Acesso restrito ao administrador.');
    window.location.href = 'index.html';
    return;
  }
  adminUsers.carregarListaUsuariosAdmin(true);
});
