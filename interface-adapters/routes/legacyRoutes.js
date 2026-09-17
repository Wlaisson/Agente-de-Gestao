import { Router } from 'express';
import path from 'path';
import { supabaseAdmin } from '../../supabaseClient.js';
import { WEBHOOK_URL } from '../../config/env.js';
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
