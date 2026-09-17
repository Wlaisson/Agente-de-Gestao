// Entidade de dominio simples (sem dependencia de framework/Supabase).
export function isAdmin(usuario) {
  return Boolean(usuario && usuario.is_admin);
}
