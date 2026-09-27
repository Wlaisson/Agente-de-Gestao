// Vocabulario de dominio para a transcricao de audio. Duas camadas, ambas sem
// custo de tokens de chat:
//
// 1. PROMPT_VOCABULARIO_WHISPER - enviado no parametro `prompt` da API de
//    transcricao. O Whisper usa esse texto como "fala anterior" e passa a
//    preferir essas grafias para nomes proprios (ClickUp, Wurth, Stellantis...).
//    Limite pratico do whisper-1: ~224 tokens - manter curto.
//
// 2. normalizarTermos() - correcao deterministica aplicada DEPOIS da IA, nos
//    campos de texto livre (titulo/descricao). Pega as grafias erradas que ja
//    apareceram no banco (ex.: "VURT", "Clicap") mesmo quando o Whisper e o
//    LLM deixam passar. Nunca aplicar em campos de lista (projeto, assunto,
//    classificacao) - esses sao validados contra as listas oficiais.

export const PROMPT_VOCABULARIO_WHISPER =
  'Registro de atividades: cadastro, inativação e correção de SKUs, imagens, ' +
  'grades e aplicações, em cards do ClickUp. Projetos e fabricantes: Wurth, ' +
  'Stellantis, Rede Pró, Agrominas, Monroe, SKF, Jurid, Pirelli, Fortbras. ' +
  'Níveis N1, N2 e N3. Google Sheets, Supabase.';

const SUBSTITUICOES = [
  // ClickUp: "Clickup", "Click up", "Click-up", "Clicap", "Clikap", "Clic up"...
  [/\bcli(?:ck|c|k|qu)?[\s-]?(?:k?[aáu]p|cap)\b/gi, 'ClickUp'],
  // Wurth: "VURT", "Vurth", "Wurt", "Würt", "Wuerth", "Würth", "WURTH"
  [/\b(?:v|w)(?:u|ü|ue)rth?\b/gi, 'Wurth'],
  // Stellantis: "Estelantis", "Stelantis", "Stellantes"
  [/\be?stell?ant[ie]s\b/gi, 'Stellantis'],
  // SKU/SKUs: "sku", "Skus", "SKU's"
  [/\bskus\b|\bsku'?s\b/gi, 'SKUs'],
  [/\bsku\b/gi, 'SKU']
];

export function normalizarTermos(texto) {
  if (!texto || typeof texto !== 'string') return texto;
  return SUBSTITUICOES.reduce((acc, [regex, correto]) => acc.replace(regex, correto), texto);
}
