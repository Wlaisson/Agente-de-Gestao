// Portado verbatim de POST /api/setup: upsert "parcial" via merge manual com
// o registro existente (le antes de escrever, cada campo cai pro valor
// existente se nao enviado). A chave da OpenAI so e sobrescrita se um valor
// nao-vazio (apos trim) for enviado - preserva a chave atual caso contrario.
export function makeSalvarConfigUsuarioUseCase({ setupRepository }) {
  return async function salvarConfigUsuario({ targetUserId, openai_api_key, openai_model, nome_pdf, empresa_pdf, descricao_pdf, contato_pdf, logo_url }) {
    const { data: existente } = await setupRepository.buscarCompleto(targetUserId);

    const dadosAtualizar = {
      user_id: targetUserId,
      openai_api_key: openai_api_key && openai_api_key.trim() ? openai_api_key.trim() : (existente?.openai_api_key || null),
      openai_model: openai_model || existente?.openai_model || 'gpt-4o-mini',
      nome_pdf: nome_pdf !== undefined ? nome_pdf : (existente?.nome_pdf || ''),
      empresa_pdf: empresa_pdf !== undefined ? empresa_pdf : (existente?.empresa_pdf || ''),
      descricao_pdf: descricao_pdf !== undefined ? descricao_pdf : (existente?.descricao_pdf || ''),
      contato_pdf: contato_pdf !== undefined ? contato_pdf : (existente?.contato_pdf || ''),
      logo_url: logo_url !== undefined ? logo_url : (existente?.logo_url || ''),
      updated_at: new Date().toISOString()
    };

    const { error } = await setupRepository.upsert(dadosAtualizar);
    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }
  };
}
