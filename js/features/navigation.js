import { obterUsuarioLogado } from '../features/auth.js';
import { TAB_TITULOS } from '../ui/sidebar.js';

// switchTab e o roteador de fato do app (SPA de uma pagina so): alterna a
// visibilidade das secoes e, para varias abas, dispara o carregamento
// "preguicoso" dos dados daquela aba na primeira vez que ela e aberta.
// Portado verbatim. `obterUsuarioLogado` e `TAB_TITULOS` ja sao modulos
// proprios e sao importados direto; o resto (mostrarToast + os ~9
// carregadores por aba + o objeto adminUsers) ainda vive no script
// principal de index.html e e injetado.
export function createNavigationFeature({
  mostrarToast,
  atualizarHomeDashboard,
  renderizarCampanhas,
  carregarDadosPlanilha,
  carregarOpcoesSistema,
  popularTodosSelects,
  carregarTarefas,
  carregarKanban,
  carregarSetupUsuario,
  adminUsers
}) {
  function switchTab(tabId) {
    const user = obterUsuarioLogado();
    if (user && !user.is_admin && tabId === 'usuarios-admin-tab') {
      mostrarToast('Acesso restrito ao administrador.', 'error');
      switchTab('home-tab');
      return;
    }
    if (user && !user.is_admin && user.permissoes && Array.isArray(user.permissoes.abas)) {
      if (tabId !== 'setup-tab' && !user.permissoes.abas.includes(tabId)) {
        mostrarToast('Acesso restrito para o seu usuário.', 'warning');
        switchTab(user.permissoes.abas[0] || 'home-tab');
        return;
      }
    }

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn, .sidebar-item').forEach(btn => {
      btn.classList.remove('active');
    });

    const targetEl = document.getElementById(tabId);
    if (targetEl) targetEl.classList.add('active');

    const activeBtns = document.querySelectorAll(`.sidebar-item[data-tab="${tabId}"]`);
    activeBtns.forEach(b => b.classList.add('active'));

    const titleEl = document.getElementById('topbar-page-title');
    if (titleEl && TAB_TITULOS[tabId]) {
      titleEl.textContent = TAB_TITULOS[tabId];
    }

    const sb = document.getElementById('app-sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    if (sb && sb.classList.contains('open')) {
      sb.classList.remove('open');
      if (bd) bd.classList.remove('active');
    }

    if (tabId === 'home-tab') {
      atualizarHomeDashboard();
    } else if (tabId === 'campanhas-tab') {
      renderizarCampanhas();
    } else if (tabId === 'semana-tab') {
      carregarDadosPlanilha();
    } else if (tabId === 'gerenciar-tab') {
      carregarOpcoesSistema();
    } else if (tabId === 'registro-tab') {
      popularTodosSelects();
    } else if (tabId === 'tarefas-tab') {
      carregarTarefas();
    } else if (tabId === 'kanban-tab') {
      carregarKanban();
    } else if (tabId === 'setup-tab' || tabId === 'relatorios-tab') {
      carregarSetupUsuario();
    } else if (tabId === 'usuarios-admin-tab') {
      adminUsers.carregarListaUsuariosAdmin(true);
    }
  }

  return { switchTab };
}
