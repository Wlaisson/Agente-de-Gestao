export function makeSetupController({ obterConfigUsuario, salvarConfigUsuario }) {
  return {
    async obter(req, res) {
      const { userId } = req.params;
      try {
        const resultado = await obterConfigUsuario(userId);
        return res.json(resultado);
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erro ao consultar setup.' });
      }
    },

    async salvar(req, res) {
      const { userId, openai_api_key, openai_model, nome_pdf, empresa_pdf, descricao_pdf, contato_pdf, logo_url } = req.body;
      const targetUserId = userId || req.headers['x-user-id'] || req.headers['user-id'];

      if (!targetUserId) {
        return res.status(400).json({ error: 'userId é obrigatório.' });
      }

      try {
        await salvarConfigUsuario({
          targetUserId,
          openai_api_key,
          openai_model,
          nome_pdf,
          empresa_pdf,
          descricao_pdf,
          contato_pdf,
          logo_url
        });
        return res.json({ status: 'success', message: 'Configurações salvas com sucesso.' });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao salvar setup do usuário.' });
      }
    }
  };
}
