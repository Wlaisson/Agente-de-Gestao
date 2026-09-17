import { Router } from 'express';
import path from 'path';
import { supabaseAdmin } from '../../supabaseClient.js';
import { WEBHOOK_URL } from '../../config/env.js';
import { opcoesRepository } from '../repositories/SupabaseOpcoesRepository.js';
import { kanbanRepository } from '../repositories/SupabaseKanbanRepository.js';
import { openAIGateway } from '../gateways/OpenAIGateway.js';

// Rotas ainda nao migradas para a camada de use-cases/repositories (fase 3
// so faz o dominio Auth/Admin). Corte-e-cola verbatim do antigo server.js -
// cada dominio abaixo migra em uma fase seguinte (opcoes, atividades, kanban,
// transcricao, relatorios, reuniao), reduzindo este arquivo ate ele sumir.
const router = Router();

router.get('/usuarios', (req, res) => {
  res.sendFile(path.resolve('usuarios.html'));
});




router.get('/api/setup/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('setup_usuario')
      .select('openai_api_key, openai_model, nome_pdf, empresa_pdf, descricao_pdf, contato_pdf, logo_url')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.json({
        status: 'success',
        configured: false,
        openai_model: 'gpt-4o-mini',
        nome_pdf: '',
        empresa_pdf: '',
        descricao_pdf: '',
        contato_pdf: '',
        logo_url: ''
      });
    }

    return res.json({
      status: 'success',
      configured: Boolean(data.openai_api_key),
      apiKeyMasked: data.openai_api_key ? `sk-...${data.openai_api_key.slice(-4)}` : '',
      openai_model: data.openai_model || 'gpt-4o-mini',
      nome_pdf: data.nome_pdf || '',
      empresa_pdf: data.empresa_pdf || '',
      descricao_pdf: data.descricao_pdf || '',
      contato_pdf: data.contato_pdf || '',
      logo_url: data.logo_url || ''
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao consultar setup.' });
  }
});

router.post('/api/setup', async (req, res) => {
  const { userId, openai_api_key, openai_model, nome_pdf, empresa_pdf, descricao_pdf, contato_pdf, logo_url } = req.body;
  const targetUserId = userId || req.headers['x-user-id'] || req.headers['user-id'];

  if (!targetUserId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  try {
    const { data: existente } = await supabaseAdmin
      .from('setup_usuario')
      .select('*')
      .eq('user_id', targetUserId)
      .single();

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

    const { error } = await supabaseAdmin
      .from('setup_usuario')
      .upsert(dadosAtualizar);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ status: 'success', message: 'Configurações salvas com sucesso.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao salvar setup do usuário.' });
  }
});



router.post('/api/gerar-relatorio', async (req, res) => {
  const { semana } = req.body;

  if (!semana) {
    return res.status(400).json({ error: 'Parâmetro "semana" é obrigatório.' });
  }

  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
  let openAiConfig;
  try {
    openAiConfig = await openAIGateway.obterCliente(userId);
  } catch (errSetup) {
    return res.status(400).json({ error: errSetup.message });
  }

  try {
    let listaAtividades = [];

    try {
      let query = supabaseAdmin
        .from('atividades')
        .select('*')
        .eq('semana', semana);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data: atvsDb } = await query;
      if (atvsDb && atvsDb.length > 0) {
        listaAtividades = atvsDb.map(a => ({
          titulo: a.titulo,
          descricao: a.atividade,
          assuntoInterno: a.assunto_interno,
          projeto: a.projeto,
          tempo: a.tempo
        }));
      }
    } catch (eDb) {
      console.log('Erro ao buscar do Supabase, tentando Sheets fallback:', eDb.message);
    }

    if (listaAtividades.length === 0) {
      try {
        const sheetRes = await fetch(`${WEBHOOK_URL}?action=semana-relatorio&semana=${encodeURIComponent(semana)}`);
        const sheetData = await sheetRes.json();
        if (sheetData && sheetData.status === 'success' && Array.isArray(sheetData.atividades)) {
          listaAtividades = sheetData.atividades;
        }
      } catch (eSheet) {
        console.log('Erro no fallback do Sheets:', eSheet.message);
      }
    }

    if (listaAtividades.length === 0) {
      return res.json({ status: 'empty', resumo: [], message: 'Nenhuma atividade encontrada para esta semana.' });
    }

    const agrupado = {};
    for (const atv of listaAtividades) {
      const chave = atv.assuntoInterno || 'Sem Assunto';
      if (!agrupado[chave]) {
        agrupado[chave] = [];
      }
      agrupado[chave].push(atv);
    }

    let textoAgrupado = '';
    for (const assunto in agrupado) {
      textoAgrupado += `[Assunto: ${assunto}]\n`;
      for (const atv of agrupado[assunto]) {
        textoAgrupado += `- Título: ${atv.titulo || 'Sem título'}\n`;
        textoAgrupado += `- Descrição: ${atv.descricao || 'Sem descrição'}\n`;
      }
      textoAgrupado += '\n';
    }

    const systemPrompt = `Você é um Tech Lead responsável por criar um relatório executivo semanal formal e técnico.
Abaixo, você receberá uma lista de micro-atividades técnicas realizadas na semana.

Sua tarefa é analisar todas as atividades e agrupá-las em grandes tópicos (Ex: "Automações e Inteligência Artificial", "Atendimentos", etc) seguindo as regras abaixo:

Diretrizes de Inteligência:
1. FORMALIDADE E CONCISÃO: A linguagem deve ser técnica, formal e "direta ao ponto" (ex: "Desenvolvimento de automação para...", "Correção de erros no software..."). Sem enrolação.
2. FILTRO RIGOROSO (O QUE NÃO INCLUIR): Ignore completamente e NÃO INCLUA: 
   - "Daily" ou "Daily Meeting"
   - "Weekly" ou reuniões de status semanais
   - Apresentações em geral (ex: "Apresentação para Everton", "Apresentação para IA", etc.)
   - Reuniões que não sejam "Atendimentos" técnicos a clientes ou parceiros (como RedePRO, Agrominas, etc).
3. CONSOLIDAÇÃO: Se houver múltiplas atividades sobre o mesmo assunto/tarefa (ex: vários atendimentos à RedePRO), UNA todas elas em uma única atividade bem resumida. Não liste várias vezes a mesma coisa.
4. ESTRUTURAÇÃO: Agrupe os itens restantes em categorias amplas (o 'titulo' do JSON será o nome da categoria). Na 'descricao', liste as atividades no formato HTML. NÃO use a palavra "Título:" nem "Descrição:". Use este formato exato:
   "<ul><li><strong>[Nome da Atividade/Assunto]:</strong> [Texto consolidado e direto da atividade, unindo tudo que for do mesmo assunto]. (Status)</li></ul>"
5. CORREÇÃO ORTOGRÁFICA: Sempre que a atividade mencionar "Process", corrija para o nome correto do software: "Prosis".

Formato de Saída Obrigatório (Gere um Objeto JSON, seguindo este esqueleto):
{
  "relatorio": [
    {
      "titulo": "Automações e Inteligência Artificial",
      "descricao": "<ul><li><strong>Software Prosis:</strong> Correção de falhas e monitoramento contínuo da extração de dados. (Concluído)</li></ul>"
    }
  ]
}

CRÍTICO E MANDATÓRIO:
1. Você é uma API de conversão de dados. O sistema depende que sua resposta seja EXCLUSIVAMENTE um JSON válido.
2. É ESTRITAMENTE PROIBIDO gerar qualquer texto de raciocínio, explicação, ou "thinking process".
3. O formato deve ser um objeto JSON puro.`;


    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Dados desta semana:\n${textoAgrupado}` },
      ],
      temperature: 0.1,
      max_tokens: 3500,
      response_format: { type: 'json_object' },
    }, openAiConfig.openai, openAiConfig.modelos);

    const respostaTexto = completions.choices[0].message.content.trim();

    let resumoArray;
    try {
      // Pega o texto da resposta
      let jsonStr = respostaTexto.trim();

      // Limpeza brutal de qualquer markdown residual
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/i, '').replace(/```$/i, '').trim();
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/i, '').replace(/```$/i, '').trim();
      }

      // Se por algum motivo o modelo "pensou", tentamos extrair apenas o objeto
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(jsonStr);
      resumoArray = parsed.relatorio || parsed;
    } catch (e) {
      console.log("Erro ao parsear JSON:", e);
      resumoArray = [{ titulo: 'Erro de Formatação', descricao: 'A IA retornou um formato inválido. Texto bruto gerado:\n' + respostaTexto }];
    }

    res.json({ status: 'success', resumo: resumoArray, semana: semana });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório semanal.' });
  }
});

router.post('/api/gerar-relatorio-reporter', async (req, res) => {
  const { semana } = req.body;

  if (!semana) {
    return res.status(400).json({ error: 'Parâmetro "semana" é obrigatório.' });
  }

  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
  let openAiConfig;
  try {
    openAiConfig = await openAIGateway.obterCliente(userId);
  } catch (errSetup) {
    return res.status(400).json({ error: errSetup.message });
  }

  try {
    let listaAtividades = [];

    try {
      let query = supabaseAdmin
        .from('atividades')
        .select('*')
        .eq('semana', semana);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data: atvsDb } = await query;
      if (atvsDb && atvsDb.length > 0) {
        listaAtividades = atvsDb.map(a => ({
          titulo: a.titulo,
          descricao: a.atividade,
          assuntoInterno: a.assunto_interno,
          projeto: a.projeto,
          tempo: a.tempo
        }));
      }
    } catch (eDb) {
      console.log('Erro ao buscar do Supabase, tentando Sheets fallback:', eDb.message);
    }

    if (listaAtividades.length === 0) {
      try {
        const sheetRes = await fetch(`${WEBHOOK_URL}?action=semana-relatorio&semana=${encodeURIComponent(semana)}`);
        const sheetData = await sheetRes.json();
        if (sheetData && sheetData.status === 'success' && Array.isArray(sheetData.atividades)) {
          listaAtividades = sheetData.atividades;
        }
      } catch (eSheet) {
        console.log('Erro no fallback do Sheets:', eSheet.message);
      }
    }

    if (listaAtividades.length === 0) {
      return res.json({ status: 'empty', quadrantes: [], message: 'Nenhuma atividade encontrada para esta semana.' });
    }

    const agrupado = {};
    for (const atv of listaAtividades) {
      const chave = atv.assuntoInterno || 'Sem Assunto';
      if (!agrupado[chave]) {
        agrupado[chave] = [];
      }
      agrupado[chave].push(atv);
    }

    let textoAgrupado = '';
    for (const assunto in agrupado) {
      textoAgrupado += `[Assunto Interno: ${assunto}]\n`;
      for (const atv of agrupado[assunto]) {
        textoAgrupado += `- Título: ${atv.titulo || 'Sem título'}`;
        if (atv.projeto) textoAgrupado += ` | Projeto: ${atv.projeto}`;
        if (atv.tempo) textoAgrupado += ` | Tempo: ${atv.tempo}`;
        textoAgrupado += `\n`;
        textoAgrupado += `  Descrição: ${atv.descricao || 'Sem descrição'}\n`;
      }
      textoAgrupado += '\n';
    }

    const systemPrompt = `Você é um Chief of Staff virtual que prepara relatórios executivos semanais para CEOs e gestores seniores.

Você receberá atividades já agrupadas por "Assunto Interno". Sua tarefa é produzir um relatório executivo de alto nível, aplicando consolidação inteligente.

## POLÍTICA DE CONSOLIDAÇÃO (CRÍTICA):

CONSOLIDAR (unir em 1 item):
- Múltiplas linhas que tratam do MESMO tema, tarefa ou processo (ex: "Tratamento de atributos IA lote 1", "Tratamento de atributos IA lote 2", "Avaliação de atributos gerados por IA" → unir tudo em "Tratamento e Avaliação de Atributos via IA").
- Atividades que são etapas ou desdobramentos de um mesmo fluxo de trabalho.
- Tarefas repetitivas do dia-a-dia sobre o mesmo assunto.

MANTER SEPARADO:
- Reuniões sobre assuntos DISTINTOS (ex: "Reunião Academy" vs "Reunião com Gustavo e Renato" são 2 itens distintos).
- Atividades que envolvem temas, clientes ou entregas fundamentalmente diferentes.
- Qualquer item que, se fundido com outro, perderia informação relevante para um gestor.

## REGRAS DE FORMATAÇÃO:

1. MANTER os agrupamentos por assunto interno EXATAMENTE como recebidos. NÃO invente novos assuntos, NÃO mescle assuntos diferentes.
2. Para cada item (consolidado ou individual), gere:
   - "titulo": Título executivo, claro e direto (máximo 8 palavras). Se consolidou várias atividades, crie um título que abranja todas.
   - "resumo": Resumo executivo em 1-3 frases. Linguagem formal, terceira pessoa, foco em RESULTADOS e ENTREGAS, não em processo. Se consolidou, mencione o escopo completo. Se houver informação de projeto/cliente, incorpore naturalmente.
3. Corrija "Process" para "Prosis".
4. NÃO inclua: dailies, weeklies, reuniões de status rotineiras, ou atividades puramente administrativas triviais.

## TOM:
- Executivo e conciso. Cada frase deve agregar valor para quem lê.
- Foco em: o que foi feito, para quem, e qual o impacto/resultado.
- Evite jargões técnicos excessivos — um CEO deve entender.

Formato de Saída OBRIGATÓRIO (JSON puro, sem markdown):
{
  "quadrantes": [
    {
      "assunto": "Nome do Assunto Interno",
      "itens": [
        { "titulo": "Título Executivo", "resumo": "Resumo executivo conciso." }
      ]
    }
  ]
}

REGRAS CRÍTICAS:
- Retorne EXCLUSIVAMENTE o JSON. Nenhum texto adicional, nenhum raciocínio, nenhum markdown.
- Mantenha TODOS os assuntos internos recebidos, mesmo que tenham apenas 1 atividade.
- Dentro de cada assunto, o número de itens finais pode ser MENOR que o número de atividades recebidas (por causa da consolidação), mas NUNCA maior.`;

    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Atividades da semana:\n${textoAgrupado}` },
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }, openAiConfig.openai, openAiConfig.modelos);

    const respostaTexto = completions.choices[0].message.content.trim();

    let quadrantesArray;
    try {
      let jsonStr = respostaTexto.trim();

      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/i, '').replace(/```$/i, '').trim();
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/i, '').replace(/```$/i, '').trim();
      }

      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(jsonStr);
      quadrantesArray = parsed.quadrantes || parsed;
    } catch (e) {
      console.log("Erro ao parsear JSON do Agente Repórter:", e);

      quadrantesArray = [];
      for (const assunto in agrupado) {
        const itens = agrupado[assunto].map(atv => ({
          titulo: atv.titulo || 'Sem título',
          resumo: atv.descricao || ''
        }));
        quadrantesArray.push({ assunto, itens });
      }
    }

    res.json({ status: 'success', quadrantes: quadrantesArray, semana: semana });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório do Agente Repórter.' });
  }
});

router.post('/api/processar-reuniao', async (req, res) => {
  const { nome_reuniao, data_reuniao, transcricao } = req.body;

  if (!transcricao) {
    return res.status(400).json({ error: 'Nenhuma transcrição enviada.' });
  }

  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
  let openAiConfig;
  try {
    openAiConfig = await openAIGateway.obterCliente(userId);
  } catch (errSetup) {
    return res.status(400).json({ error: errSetup.message });
  }

  try {
    const textoCompleto = transcricao;

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
        { role: 'user', content: `Dados da Agenda:\nNome da Reunião: ${nome_reuniao || 'Não informado'}\nData: ${data_reuniao || 'Não informada'}\n\nTexto da Transcrição:\n${textoCompleto}` },
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
          console.log("Falha no parse do JSON da reunião. Resposta bruta:", respostaTexto.substring(0, 500));
          jsonResult = { nome_reuniao: nome_reuniao, data_reuniao: data_reuniao, resumo_geral: "", minhas_tarefas: [] };
        }
      } else {
        console.log("Nenhum JSON encontrado na resposta da reunião. Resposta bruta:", respostaTexto.substring(0, 500));
        jsonResult = { nome_reuniao: nome_reuniao, data_reuniao: data_reuniao, resumo_geral: "", minhas_tarefas: [] };
      }
    }

    function sanitizarTexto(val) {
      if (!val) return '';
      const trimmed = val.trim();
      const placeholders = ['...', '\u2026', 'descri\u00e7\u00e3o da tarefa', 'contexto da tarefa', 'prazo', 'nome da reuni\u00e3o', 'data da reuni\u00e3o', 'resumo extra\u00eddo'];
      if (placeholders.includes(trimmed.toLowerCase())) return '';
      return trimmed;
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
        try {
          await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add_tasks',
              nome_reuniao: sanitizarTexto(jsonResult.nome_reuniao) || nome_reuniao || '',
              data_reuniao: sanitizarTexto(jsonResult.data_reuniao) || data_reuniao || '',
              tarefa: tarefaObj.tarefa,
              contexto: tarefaObj.contexto,
              prazo: tarefaObj.prazo_mencionado
            })
          });
        } catch (sheetErr) {
          console.error("Erro ao salvar tarefa no sheets:", sheetErr);
        }
      }
    }

    res.json(jsonResult);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar reunião.' });
  }
});


export default router;
