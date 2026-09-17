import { TAB_TITULOS } from '../ui/sidebar.js';
import { abrirModal, fecharModal } from '../ui/modal.js';

const MODAL_ID = 'modalNovoUsuario';

// Fabrica a fatia de administracao de usuarios (lista/criar/excluir), hoje
// duplicada quase byte-a-byte entre index.html e usuarios.html. `mostrarToast`
// e `obterUsuarioLogado` sao injetados porque cada pagina tem sua propria
// implementacao/local de import desses dois (evita acoplar este modulo a
// qualquer uma das duas paginas).
//
// Nota de consolidacao (nao e mudanca de seguranca/funcional, so redacao):
// a versao de index.html retornava silenciosamente quando o usuario logado
// nao era admin, enquanto usuarios.html mostrava uma mensagem no tbody; como
// usuarios.html ja redireciona usuarios nao-admin antes de chamar esta
// funcao, esse branch era código morto la. Adotamos aqui o retorno
// silencioso. Da mesma forma, o texto do toast de exclusao ("removido" vs
// "excluído") foi unificado.
export function createAdminUsersModule({ mostrarToast, obterUsuarioLogado }) {
  async function carregarListaUsuariosAdmin(forcado = false) {
    const user = obterUsuarioLogado();
    if (!user || !user.is_admin) return;

    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    if (forcado) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">Sincronizando com o Supabase...</td></tr>';
    }

    try {
      const res = await fetch('/api/admin/usuarios');
      const result = await res.json();

      if (!res.ok || result.status !== 'success') {
        throw new Error(result.error || 'Erro ao buscar usuários.');
      }

      const usuarios = result.data || [];
      if (usuarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum usuário cadastrado além do administrador.</td></tr>';
        return;
      }

      let html = '';
      usuarios.forEach(u => {
        const nome = u.nome || u.email.split('@')[0];
        const partes = nome.trim().split(' ');
        const iniciais = partes.length > 1
          ? (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
          : nome.substring(0, 2).toUpperCase();

        const dataFormatada = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '-';
        const roleBadge = u.is_admin
          ? '<span class="user-role-badge badge-role-admin">Admin</span>'
          : '<span class="user-role-badge badge-role-membro">Membro</span>';

        let abasHtml = '';
        if (u.is_admin) {
          abasHtml = '<span class="badge-tab-item" style="color: #9333ea; font-weight: 600;">Acesso Total (Todas as Abas)</span>';
        } else if (u.permissoes && Array.isArray(u.permissoes.abas) && u.permissoes.abas.length > 0) {
          abasHtml = u.permissoes.abas.map(a => `<span class="badge-tab-item">${TAB_TITULOS[a] || a}</span>`).join(' ');
        } else {
          abasHtml = '<span class="badge-tab-item" style="color: var(--danger);">Sem abas atribuídas</span>';
        }

        const acaoExcluir = u.is_admin
          ? '<span style="color: var(--text-muted); font-size: 0.8rem;">Protegido</span>'
          : `<button type="button" class="btn btn-secondary" onclick="excluirUsuarioAdmin('${u.id}', '${nome}')" style="width: auto; padding: 0.35rem 0.75rem; font-size: 0.8rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);">Excluir</button>`;

        html += `
                        <tr>
                            <td>
                                <div class="user-table-cell-info">
                                    <div class="user-table-avatar">${iniciais}</div>
                                    <div>
                                        <div style="font-weight: 600;">${nome}</div>
                                        <div style="font-size: 0.8rem; color: var(--text-muted);">${u.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td>${roleBadge}</td>
                            <td style="max-width: 320px;">${abasHtml}</td>
                            <td>${dataFormatada}</td>
                            <td style="text-align: right;">${acaoExcluir}</td>
                        </tr>
                    `;
      });

      tbody.innerHTML = html;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 2rem;">Erro ao carregar usuários: ${err.message}</td></tr>`;
    }
  }

  function abrirModalNovoUsuario() {
    const erroEl = document.getElementById('novo-usuario-erro');
    if (erroEl) erroEl.style.display = 'none';
    abrirModal(MODAL_ID);
  }

  function fecharModalNovoUsuario() {
    fecharModal(MODAL_ID);
  }

  function marcarTodasPermissoes(marcar) {
    document.querySelectorAll('#grid-permissoes-usuario input[type="checkbox"]').forEach(chk => {
      chk.checked = marcar;
    });
  }

  async function salvarNovoUsuario(event) {
    event.preventDefault();
    const nomeInput = document.getElementById('novo-user-nome');
    const emailInput = document.getElementById('novo-user-email');
    const senhaInput = document.getElementById('novo-user-senha');
    const erroEl = document.getElementById('novo-usuario-erro');
    const btnSubmit = document.getElementById('btn-submit-novo-user');

    if (!nomeInput || !emailInput || !senhaInput) return;
    const nome = nomeInput.value.trim();
    const email = emailInput.value.trim();
    const password = senhaInput.value;

    const abas = [];
    document.querySelectorAll('#grid-permissoes-usuario input[type="checkbox"]:checked').forEach(chk => {
      abas.push(chk.value);
    });

    if (erroEl) erroEl.style.display = 'none';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Criando no Supabase Auth...';
    }

    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          email,
          password,
          permissoes: { abas }
        })
      });

      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.error || 'Erro ao criar usuário.');
      }

      mostrarToast('Usuário cadastrado com sucesso!', 'success');
      fecharModalNovoUsuario();
      nomeInput.value = '';
      emailInput.value = '';
      senhaInput.value = '';
      carregarListaUsuariosAdmin(true);
    } catch (err) {
      if (erroEl) {
        erroEl.textContent = err.message;
        erroEl.style.display = 'block';
      }
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<span><svg class="app-icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span> Criar Usuário com Acesso';
      }
    }
  }

  async function excluirUsuarioAdmin(id, nome) {
    if (!confirm(`Tem certeza que deseja excluir o usuário "${nome}"? O acesso será revogado imediatamente.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/usuarios/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (!res.ok || data.status !== 'success') {
        throw new Error(data.error || 'Erro ao excluir usuário.');
      }

      mostrarToast('Usuário removido com sucesso.', 'info');
      carregarListaUsuariosAdmin(true);
    } catch (err) {
      mostrarToast(err.message, 'error');
    }
  }

  return {
    carregarListaUsuariosAdmin,
    abrirModalNovoUsuario,
    fecharModalNovoUsuario,
    marcarTodasPermissoes,
    salvarNovoUsuario,
    excluirUsuarioAdmin
  };
}
