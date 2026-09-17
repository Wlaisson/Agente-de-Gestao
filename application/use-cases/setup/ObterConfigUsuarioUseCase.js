// Portado verbatim de GET /api/setup/:userId. Nunca devolve a chave crua -
// so `apiKeyMasked` (ultimos 4 caracteres).
export function makeObterConfigUsuarioUseCase({ setupRepository }) {
  return async function obterConfigUsuario(userId) {
    const { data, error } = await setupRepository.buscarCamposPublicos(userId);

    if (error || !data) {
      return {
        status: 'success',
        configured: false,
        openai_model: 'gpt-4o-mini',
        nome_pdf: '',
        empresa_pdf: '',
        descricao_pdf: '',
        contato_pdf: '',
        logo_url: ''
      };
    }

    return {
      status: 'success',
      configured: Boolean(data.openai_api_key),
      apiKeyMasked: data.openai_api_key ? `sk-...${data.openai_api_key.slice(-4)}` : '',
      openai_model: data.openai_model || 'gpt-4o-mini',
      nome_pdf: data.nome_pdf || '',
      empresa_pdf: data.empresa_pdf || '',
      descricao_pdf: data.descricao_pdf || '',
      contato_pdf: data.contato_pdf || '',
      logo_url: data.logo_url || ''
    };
  };
}
