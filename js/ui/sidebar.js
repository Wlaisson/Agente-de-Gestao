// TAB_TITULOS e toggleSidebar eram declarados de forma byte-identica em
// index.html e usuarios.html. Portados verbatim.
export const TAB_TITULOS = {
  'home-tab': 'Início / Home Dashboard',
  'registro-tab': 'Criar Nova Atividade',
  'kanban-tab': 'Quadro Kanban',
  'campanhas-tab': 'Gestão de Campanhas',
  'reporter-tab': 'Agente Reporter 4',
  'semana-tab': 'Atividades da Semana',
  'resumo-tab': 'Resumo Executivo',
  'relatorios-tab': 'Dashboard & Relatórios',
  'tarefas-tab': 'Tarefas de Reuniões',
  'gerenciar-tab': 'Gerenciamento de Assuntos & Opções',
  'setup-tab': 'Configurações de IA & Chaves',
  'usuarios-admin-tab': 'Gestão de Usuários (RBAC)'
};

export function toggleSidebar() {
  const sb = document.getElementById('app-sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if (!sb) return;
  sb.classList.toggle('open');
  if (bd) bd.classList.toggle('active');
}
