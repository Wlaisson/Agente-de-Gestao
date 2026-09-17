// Controller fino para os 3 endpoints de administracao de usuarios. Mesmos
// status codes/mensagens do server.js original; `verificarAdmin` continua
// aplicado como middleware nas rotas, nao aqui.
export function makeAdminController({ criarUsuario, listarUsuarios, excluirUsuario }) {
  return {
    async criar(req, res) {
      const { email, password, nome, permissoes } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      }

      try {
        const usuario = await criarUsuario({ email, password, nome, permissoes });
        return res.json({ status: 'success', user: usuario });
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({ error: err.message });
        }
        console.error(err);
        return res.status(500).json({ error: 'Erro ao criar usuário.' });
      }
    },

    async listar(req, res) {
      try {
        const data = await listarUsuarios();
        return res.json({ status: 'success', data });
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({ error: err.message });
        }
        console.error(err);
        return res.status(500).json({ error: 'Erro ao listar usuários.' });
      }
    },

    async excluir(req, res) {
      const { id } = req.params;
      try {
        await excluirUsuario(id);
        return res.json({ status: 'success' });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erro ao excluir usuário.' });
      }
    }
  };
}
