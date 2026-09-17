// Config centralizada, extraida de server.js. Mesmos valores-padrao de antes:
// comportamento identico com ou sem as variaveis de ambiente definidas.
export const PORT = process.env.PORT || 5555;

// Webhook legado (Google Apps Script) usado como espelho de escrita para
// atividades/kanban/reunioes. Hardcoded originalmente; mantido como fallback
// para nao mudar comportamento caso a env var nao esteja definida em algum
// ambiente de deploy existente.
export const WEBHOOK_URL = process.env.WEBHOOK_URL
  || 'https://script.google.com/macros/s/AKfycbxzPiZ7Dv2aUgT-ues0F8Q9UeSlVScUCJY2DLgyo1DxsTSjD9Lu4_SsaGD1P5gYvrEh_w/exec';
