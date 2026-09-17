import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Filtra placeholders/junk que a IA as vezes devolve (reticencias, ou o eco
// literal dos nomes dos campos do schema JSON como se fossem valores).
// Portado verbatim (era uma funcao aninhada dentro da rota original).
function sanitizarTexto(val) {
  if (!val) return '';
  const trimmed = val.trim();
  const placeholders = ['...', '\u2026', 'descri\u00e7\u00e3o da tarefa', 'contexto da tarefa', 'prazo', 'nome da reuni\u00e3o', 'data da reuni\u00e3o', 'resumo extra\u00eddo'];
  if (placeholders.includes(trimmed.toLowerCase())) return '';
  return trimmed;
}

// Portado verbatim de POST /api/processar-reuniao.
export function makeProcessarReuniaoUseCase({ openAIGateway }) {
  return async function processarReuniao({ userId, nome_reuniao, data_reuniao, transcricao }) {
    let openAiConfig;
    try {
      openAiConfig = await openAIGateway.obterCliente(userId);
    } catch (errSetup) {
      const erro = new Error(errSetup.message);
      erro.status = 400;
      throw erro;
    }

    const systemPrompt = `Você é um Assistente Executivo de Inteligência Artificial focado em gestão de tempo e produtividade.
Vou te enviar a transcrição de uma reunião de trabalho e os dados da agenda.

Sua tarefa é analisar o diálogo e extrair APENAS as informações solicitadas, com foco absoluto nas tarefas (Action Items) que foram atribuídas diretamente a mim ou que eu mesmo me comprometi a fazer.

Diretrizes de Inteligência:
1. Ignore tarefas que foram atribuídas a outras pessoas na reunião. Foque apenas no que EU devo fazer.
2. Identifique o contexto. Se alguém disse "precisamos que você olhe aquele erro de token amanhã", transforme isso em uma tarefa acionável e clara.
3. Se nenhuma tarefa foi atribuída a mim, retorne um array vazio [] no campo 'minhas_tarefas'.
4. O campo 'resumo_geral' deve servir apenas para eu lembrar do que se tratou a reunião, sem detalhes excessivos. Se não houver resumo, deixe vazio ("").
5. JAMAIS retorne reticências ("...") ou textos de preenchimento genéricos. Se não tiver a informação, retorne uma string vazia "".
6. Para 'nome_reuniao' e 'data_reuniao', use EXATAMENTE os valores fornecidos em "Dados da Agenda" na mensagem do usuário. NÃO invente.
7. Cada tarefa DEVE conter uma descrição real e específica extraída da transcrição. NUNCA repita os nomes dos campos como "descrição da tarefa" ou "contexto da tarefa" — esses são apenas rótulos do esquema JSON, não valores.

Retorne APENAS um objeto JSON válido seguindo a estrutura abaixo, sem marcações markdown.
Exemplo de resposta correta:
{
  "nome_reuniao": "Daily de Segunda",
  "data_reuniao": "2026-08-25",
  "resumo_geral": "Reunião de alinhamento sobre pendências do projeto X e priorização de demandas",
  "minhas_tarefas": [
    {
      "tarefa": "Corrigir o bug de autenticação no módulo de login",
      "contexto": "O cliente reportou erro 401 ao tentar acessar o painel administrativo",
      "prazo_mencionado": "até quarta-feira"
    }
  ]
}

Se não houver tarefas atribuídas a mim, retorne minhas_tarefas como array vazio [].`;

    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Dados da Agenda:\nNome da Reunião: ${nome_reuniao || 'Não informado'}\nData: ${data_reuniao || 'Não informada'}\n\nTexto da Transcrição:\n${transcricao}` }
      ],
      temperature: 0.2,
      max_tokens: 4000
    }, openAiConfig.openai, openAiConfig.modelos);

    let respostaTexto = completions.choices[0].message.content.trim();
    respostaTexto = respostaTexto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    if (respostaTexto.startsWith('```json')) {
      respostaTexto = respostaTexto.replace(/^```json/i, '').replace(/```$/i, '').trim();
    } else if (respostaTexto.startsWith('```')) {
      respostaTexto = respostaTexto.replace(/^```/i, '').replace(/```$/i, '').trim();
    }

    let jsonResult;
    try {
      jsonResult = JSON.parse(respostaTexto);
    } catch (e) {
      const firstBrace = respostaTexto.indexOf('{');
      const lastBrace = respostaTexto.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          jsonResult = JSON.parse(respostaTexto.substring(firstBrace, lastBrace + 1));
        } catch (errParse) {
          console.log('Falha no parse do JSON da reunião. Resposta bruta:', respostaTexto.substring(0, 500));
          jsonResult = { nome_reuniao, data_reuniao, resumo_geral: '', minhas_tarefas: [] };
        }
      } else {
        console.log('Nenhum JSON encontrado na resposta da reunião. Resposta bruta:', respostaTexto.substring(0, 500));
        jsonResult = { nome_reuniao, data_reuniao, resumo_geral: '', minhas_tarefas: [] };
      }
    }

    if (jsonResult.resumo_geral) {
      jsonResult.resumo_geral = sanitizarTexto(jsonResult.resumo_geral);
    }

    if (jsonResult.minhas_tarefas && Array.isArray(jsonResult.minhas_tarefas)) {
      jsonResult.minhas_tarefas = jsonResult.minhas_tarefas.filter(t => {
        const tarefa = sanitizarTexto(t.tarefa);
        return tarefa.length > 0;
      });
      jsonResult.minhas_tarefas.forEach(t => {
        t.tarefa = sanitizarTexto(t.tarefa);
        t.contexto = sanitizarTexto(t.contexto);
        t.prazo_mencionado = sanitizarTexto(t.prazo_mencionado);
      });
      for (const tarefaObj of jsonResult.minhas_tarefas) {
        await enviarParaWebhookLegado({
          action: 'add_tasks',
          nome_reuniao: sanitizarTexto(jsonResult.nome_reuniao) || nome_reuniao || '',
          data_reuniao: sanitizarTexto(jsonResult.data_reuniao) || data_reuniao || '',
          tarefa: tarefaObj.tarefa,
          contexto: tarefaObj.contexto,
          prazo: tarefaObj.prazo_mencionado
        });
      }
    }

    return jsonResult;
  };
}
