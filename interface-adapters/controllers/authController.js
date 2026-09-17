// Controller fino: valida input, chama o use-case, formata a resposta HTTP.
// Mesmos status codes e mensagens do server.js original.
export function makeAuthController({ autenticarUsuario }) {
  return {
    async login(req, res) {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      }

      try {
        const { session, user } = await autenticarUsuario({ email, password });
        return res.json({ status: 'success', session, user });
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({ error: err.message });
        }
        console.error(err);
        return res.status(500).json({ error: 'Erro interno ao autenticar.' });
      }
    }
  };
}
