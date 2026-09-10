import { supabaseAdmin } from '../supabaseClient.js';

export async function verificarAdmin(req, res, next) {
  const userId = req.headers['x-user-id'] || req.headers['user-id'];

  if (!userId) {
    return res.status(403).json({ error: 'Acesso negado: ID de usuário não fornecido.' });
  }

  try {
    const { data: usuario, error } = await supabaseAdmin
      .from('usuarios')
      .select('id, is_admin')
      .eq('id', userId)
      .single();

    if (error || !usuario || !usuario.is_admin) {
      return res.status(403).json({ error: 'Acesso negado: Requer privilégios de Administrador.' });
    }

    req.usuarioAdmin = usuario;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno na verificação de permissões.' });
  }
}
