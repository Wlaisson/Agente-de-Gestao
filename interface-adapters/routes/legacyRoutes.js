import { Router } from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import path from 'path';
import { supabase, supabaseAdmin } from '../../supabaseClient.js';
import { WEBHOOK_URL } from '../../config/env.js';
import { opcoesRepository } from '../repositories/SupabaseOpcoesRepository.js';

// Rotas ainda nao migradas para a camada de use-cases/repositories (fase 3
// so faz o dominio Auth/Admin). Corte-e-cola verbatim do antigo server.js -
// cada dominio abaixo migra em uma fase seguinte (opcoes, atividades, kanban,
// transcricao, relatorios, reuniao), reduzindo este arquivo ate ele sumir.
const router = Router();
const openaiGlobal = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const upload = multer({ storage: multer.memoryStorage() });




router.get('/usuarios', (req, res) => {
  res.sendFile(path.resolve('usuarios.html'));
});

const MODELOS = [
  process.env.OPENAI_MODEL || 'gpt-5-nano',
  'gpt-4o-mini'
];

async function obterClienteOpenAI(userId) {
  if (userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('setup_usuario')
        .select('openai_api_key, openai_model')
        .eq('user_id', userId)
        .single();

      if (!error && data && data.openai_api_key) {
        return {
          openai: new OpenAI({ apiKey: data.openai_api_key }),
          modelos: [data.openai_model || 'gpt-4o-mini', 'gpt-4o-mini']
        };
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (openaiGlobal) {
    return {
      openai: openaiGlobal,
      modelos: MODELOS
    };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('setup_usuario')
      .select('openai_api_key, openai_model')
      .not('openai_api_key', 'is', null)
      .limit(1);

    if (!error && data && data.length > 0 && data[0].openai_api_key) {
      return {
        openai: new OpenAI({ apiKey: data[0].openai_api_key }),
        modelos: [data[0].openai_model || 'gpt-4o-mini', 'gpt-4o-mini']
      };
    }
  } catch (e) {
    console.error(e);
  }

  throw new Error('Setup incompleto: Chave da OpenAI não configurada');
}

async function chamarModelo(params, clientOverride, modelosOverride) {
  const openaiInstance = clientOverride || openaiGlobal;
  if (!openaiInstance) {
    throw new Error('Setup incompleto: Chave da OpenAI não configurada');
  }
  const listaModelos = modelosOverride && modelosOverride.length > 0 ? modelosOverride : MODELOS;
  let ultimoErro;
  for (const modelo of listaModelos) {
    try {
      const payload = { ...params, model: modelo };
      if (payload.max_tokens && !payload.max_completion_tokens) {
        payload.max_completion_tokens = payload.max_tokens;
        delete payload.max_tokens;
      }
      if (modelo.startsWith('gpt-5') || modelo.startsWith('o1') || modelo.startsWith('o3') || modelo.startsWith('o4')) {
        delete payload.temperature;
      }
      const resultado = await openaiInstance.chat.completions.create(payload);
      return resultado;
    } catch (err) {
      ultimoErro = err;
      console.log(`[MODELO] Falha com ${modelo}: ${err.status || err.message}`);
    }
  }
  throw ultimoErro;
}

const chamarModeloComFallback = chamarModelo;







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

function calcularSemanaDeData(dataStr) {
  if (!dataStr) return '';
  try {
    const partes = String(dataStr).split('-');
    if (partes.length === 3) {
      const ano = parseInt(partes[0], 10);
      const mes = parseInt(partes[1], 10) - 1;
      const dia = parseInt(partes[2], 10);
      const d = new Date(ano, mes, dia);
      if (!isNaN(d.getTime())) {
        const diaSemana = d.getDay();
        const diffParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
        const segunda = new Date(d);
        segunda.setDate(d.getDate() + diffParaSegunda);
        const domingo = new Date(segunda);
        domingo.setDate(segunda.getDate() + 6);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(segunda.getDate())}/${pad(segunda.getMonth() + 1)} a ${pad(domingo.getDate())}/${pad(domingo.getMonth() + 1)}`;
      }
    }
  } catch (e) {}
  return '';
}

function calcularMetasData(dataStr) {
  let diaSemana = '';
  let mes = '';
  let semana = '';
  if (!dataStr) return { diaSemana, mes, semana };
  try {
    const partes = String(dataStr).split('-');
    if (partes.length === 3) {
      const ano = parseInt(partes[0], 10);
      const mesNum = parseInt(partes[1], 10) - 1;
      const dia = parseInt(partes[2], 10);
      const d = new Date(ano, mesNum, dia);
      if (!isNaN(d.getTime())) {
        const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
        diaSemana = diasSemana[d.getDay()];
        const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        mes = meses[d.getMonth()] + '/' + ano;
        const diffParaSegunda = d.getDay() === 0 ? -6 : 1 - d.getDay();
        const segunda = new Date(d);
        segunda.setDate(d.getDate() + diffParaSegunda);
        const domingo = new Date(segunda);
        domingo.setDate(segunda.getDate() + 6);
        const pad = n => String(n).padStart(2, '0');
        semana = `${pad(segunda.getDate())}/${pad(segunda.getMonth() + 1)} a ${pad(domingo.getDate())}/${pad(domingo.getMonth() + 1)}`;
      }
    }
  } catch (e) {}
  return { diaSemana, mes, semana };
}

router.get('/api/atividades', async (req, res) => {
  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.query.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  try {
    let query = supabaseAdmin
      .from('atividades')
      .select('*')
      .order('data', { ascending: false })
      .order('created_at', { ascending: false });

    if (req.query.todos !== 'true') {
      query = query.eq('user_id', userId);
    }

    if (req.query.semana) {
      query = query.eq('semana', req.query.semana);
    }

    if (req.query.start && req.query.end) {
      query = query.gte('data', req.query.start).lte('data', req.query.end);
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const formatadas = (data || []).map(item => {
      const meta = calcularMetasData(item.data);
      const semanaFinal = (item.semana && item.semana.trim() !== '') ? item.semana : meta.semana;
      return {
        id: item.id,
        row: item.id,
        data: item.data,
        diaSemana: meta.diaSemana,
        mes: meta.mes,
        semana: semanaFinal,
        projeto: item.projeto || '',
        assuntoInterno: item.assunto_interno || '',
        titulo: item.titulo || '',
        atividade: item.atividade || '',
        tempo: item.tempo || '00:00:00',
        classNivel1: item.class_nivel_1 || '',
        classNivel2: item.class_nivel_2 || '',
        userId: item.user_id
      };
    });

    return res.json({ status: 'success', data: formatadas });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar atividades.' });
  }
});

router.post('/api/atividades', async (req, res) => {
  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const b = req.body || {};
  const dataFinal = b.data || b.Data || new Date().toISOString().split('T')[0];
  let semanaFinal = b.semana || b['Texto Semana'] || b.textoSemana || '';
  if (!semanaFinal || semanaFinal.trim() === '') {
    semanaFinal = calcularSemanaDeData(dataFinal);
  }

  const projetoFinal = b.projeto || b.Projeto || '';
  const assuntoFinal = b.assuntoInterno || b.assunto_interno || b['Assunto Interno'] || '';
  const tituloFinal = b.titulo || b['Título'] || b.Titulo || '';
  const atividadeFinal = b.atividade || b.descricao || b['Atividade [Deixar claro no texto]'] || b.Atividade || '';
  const tempoFinal = b.tempo || b['Tempo (HH:MM:SS)'] || b.Tempo || '00:00:00';
  const c1Final = b.classNivel1 || b.class_nivel_1 || b['Classificação nivel 1'] || b['Classificacao nivel 1'] || b['Classificação Nível 1'] || '';
  const c2Final = b.classNivel2 || b.class_nivel_2 || b['Classificação nivel 2'] || b['Classificacao nivel 2'] || b['Classificação Nível 2'] || '';

  const novoId = b.id || `ATV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const registro = {
    id: novoId,
    user_id: userId,
    data: dataFinal,
    semana: semanaFinal,
    projeto: projetoFinal,
    assunto_interno: assuntoFinal,
    titulo: tituloFinal,
    atividade: atividadeFinal,
    tempo: tempoFinal,
    class_nivel_1: c1Final,
    class_nivel_2: c2Final,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    const { error } = await supabaseAdmin
      .from('atividades')
      .upsert(registro);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    try {
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          id: registro.id,
          data: registro.data,
          semana: registro.semana,
          projeto: registro.projeto,
          assuntoInterno: registro.assunto_interno,
          titulo: registro.titulo,
          atividade: registro.atividade,
          tempo: registro.tempo,
          classNivel1: registro.class_nivel_1,
          classNivel2: registro.class_nivel_2
        })
      }).catch(e => console.log('Sheets fallback aviso:', e.message));
    } catch (sheetErr) {
      console.log('Sheets fallback aviso:', sheetErr.message);
    }

    return res.json({ status: 'success', data: registro });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao registrar atividade.' });
  }
});

router.put('/api/atividades/:id', async (req, res) => {
  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body.userId;
  const { id } = req.params;
  const b = req.body || {};

  try {
    const dados = {
      updated_at: new Date().toISOString()
    };

    const dataVal = b.data !== undefined ? b.data : b.Data;
    if (dataVal !== undefined) dados.data = dataVal;

    const semanaVal = b.semana !== undefined ? b.semana : (b['Texto Semana'] !== undefined ? b['Texto Semana'] : b.textoSemana);
    if (semanaVal !== undefined) dados.semana = semanaVal;

    const projVal = b.projeto !== undefined ? b.projeto : b.Projeto;
    if (projVal !== undefined) dados.projeto = projVal;

    const assuntoVal = b.assuntoInterno !== undefined ? b.assuntoInterno : (b.assunto_interno !== undefined ? b.assunto_interno : b['Assunto Interno']);
    if (assuntoVal !== undefined) dados.assunto_interno = assuntoVal;

    const tituloVal = b.titulo !== undefined ? b.titulo : (b['Título'] !== undefined ? b['Título'] : b.Titulo);
    if (tituloVal !== undefined) dados.titulo = tituloVal;

    const ativVal = b.atividade !== undefined ? b.atividade : (b.descricao !== undefined ? b.descricao : (b['Atividade [Deixar claro no texto]'] !== undefined ? b['Atividade [Deixar claro no texto]'] : b.Atividade));
    if (ativVal !== undefined) dados.atividade = ativVal;

    const tempoVal = b.tempo !== undefined ? b.tempo : (b['Tempo (HH:MM:SS)'] !== undefined ? b['Tempo (HH:MM:SS)'] : b.Tempo);
    if (tempoVal !== undefined) dados.tempo = tempoVal;

    const c1Val = b.classNivel1 !== undefined ? b.classNivel1 : (b.class_nivel_1 !== undefined ? b.class_nivel_1 : (b['Classificação nivel 1'] !== undefined ? b['Classificação nivel 1'] : b['Classificação Nível 1']));
    if (c1Val !== undefined) dados.class_nivel_1 = c1Val;

    const c2Val = b.classNivel2 !== undefined ? b.classNivel2 : (b.class_nivel_2 !== undefined ? b.class_nivel_2 : (b['Classificação nivel 2'] !== undefined ? b['Classificação nivel 2'] : b['Classificação Nível 2']));
    if (c2Val !== undefined) dados.class_nivel_2 = c2Val;

    if ((!dados.semana || dados.semana.trim() === '') && dados.data) {
      dados.semana = calcularSemanaDeData(dados.data);
    }

    let query = supabaseAdmin.from('atividades').update(dados).eq('id', id);
    if (userId) query = query.eq('user_id', userId);

    const { error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar atividade.' });
  }
});

router.delete('/api/atividades/:id', async (req, res) => {
  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.query.userId;
  const { id } = req.params;

  try {
    let query = supabaseAdmin.from('atividades').delete().eq('id', id);
    if (userId) query = query.eq('user_id', userId);

    const { error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao excluir atividade.' });
  }
});

router.post('/api/transcrever', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
  let openAiConfig;
  try {
    openAiConfig = await obterClienteOpenAI(userId);
  } catch (errSetup) {
    return res.status(400).json({ error: errSetup.message });
  }

  try {
    const audioFile = await toFile(req.file.buffer, req.file.originalname || 'audio.webm', {
      type: req.file.mimetype || 'audio/webm'
    });

    const transcricao = await openAiConfig.openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt',
      response_format: 'json',
    });

    const textoCompleto = transcricao.text;

    const opcoes = await opcoesRepository.carregar();
    const { projetosStr, assuntosStr, classificacoesStr } = formatarListasParaPrompt(opcoes);

    const systemPrompt = `Você é um assistente executivo de alta senioridade, especializado em registrar atividades corporativas e de engenharia/produto com linguagem formal, concisa e altamente profissional.
Receberás a transcrição falada de um relato de atividade de um profissional. Transcrições de voz frequentemente contêm correções espontâneas ("ou melhor", "digo"), hesitações, gírias e linguagem informal ("a gente", "né").

Sua obrigação é filtrar esses vícios e transformar o relato em um registro técnico e executivo impecável.

Retorne EXCLUSIVAMENTE um objeto JSON válido com os seguintes campos:

{
  "projeto_oficial": "Identifique e selecione o projeto EXATO da 'Lista de Projetos Válidos'. Se o usuário mencionar 'projeto interno' ou 'interno', mapeie para 'Interno'.",
  "assunto_interno": "Identifique e selecione o assunto interno EXATO da 'Lista de Assuntos Internos Válidos'. Ex: se o usuário falar 'agente de aplicação', selecione 'Agente de Aplicações'. Se falar 'reunião com fulano', selecione o assunto correspondente.",
  "titulo": "Crie um título executivo de alto nível, sintético e profissional (3 a 6 palavras) que resuma o núcleo da atividade. NUNCA use palavras truncadas e NUNCA copie o início da transcrição.",
  "descricao": "Redija um resumo formal, objetivo e detalhado em terceira pessoa (voz passiva executiva, ex: 'Realizada reunião...', 'Alinhamento com...', 'Desenvolvido...'). Elimine vícios de fala, redundâncias e informalidades. Destaque com clareza o objetivo, as deliberações técnicas e os desdobramentos práticos.",
  "tempo": "Extraia o tempo final mencionado no formato HH:MM:SS. Ex: se mencionou '20 minutos, 25 minutos', adote 00:25:00. Padrão: 01:00:00 se não especificado.",
  "classNivel1": "Selecione o Nível 1 da combinação mais aderente da lista.",
  "classNivel2": "Selecione o Nível 2 correspondente ao Nível 1 escolhido da lista."
}

Lista de Projetos Válidos:
${projetosStr}

Lista de Assuntos Internos Válidos:
${assuntosStr}

Lista de Combinações de Classificação (Nível 1 / Nível 2):
${classificacoesStr}

Diretrizes Críticas:
1. Jamais devolva a transcrição crua na descrição.
2. Jamais trunque frases no título.
3. O JSON deve ser 100% puro e parseável.`;

    const completions = await chamarModeloComFallback({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Relato transcrito:\n"${textoCompleto}"`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
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
        } catch (innerErr) {
          jsonResult = null;
        }
      }
      if (!jsonResult) {
        const matchTitulo = respostaTexto.match(/"titulo"\s*:\s*"([^"]+)"/i);
        const matchDesc = respostaTexto.match(/"descricao"\s*:\s*"([^"]+)"/i);
        const matchProj = respostaTexto.match(/"projeto_oficial"\s*:\s*"([^"]+)"/i);
        const matchAssunto = respostaTexto.match(/"assunto_interno"\s*:\s*"([^"]+)"/i);
        const matchTempo = respostaTexto.match(/"tempo"\s*:\s*"([^"]+)"/i);
        const matchC1 = respostaTexto.match(/"classNivel1"\s*:\s*"([^"]+)"/i);
        const matchC2 = respostaTexto.match(/"classNivel2"\s*:\s*"([^"]+)"/i);

        jsonResult = {
          projeto_oficial: matchProj ? matchProj[1] : 'Interno',
          assunto_interno: matchAssunto ? matchAssunto[1] : '',
          titulo: matchTitulo ? matchTitulo[1] : 'Registro de Atividade',
          descricao: matchDesc ? matchDesc[1] : 'Atividade realizada conforme alinhamento.',
          tempo: matchTempo ? matchTempo[1] : '01:00:00',
          classNivel1: matchC1 ? matchC1[1] : '',
          classNivel2: matchC2 ? matchC2[1] : ''
        };
      }
    }

    res.json(jsonResult);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar áudio.' });
  }
});

const KANBAN_FILE = path.join(process.cwd(), 'kanban_data.json');

async function carregarCards() {
  try {
    const { data, error } = await supabase
      .from('kanban_cards')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map(item => ({
        id: item.id,
        titulo: item.titulo || '',
        descricao: item.descricao || '',
        projeto: item.projeto || '',
        assuntoInterno: item.assunto_interno || '',
        classNivel1: item.class_nivel_1 || '',
        classNivel2: item.class_nivel_2 || '',
        prioridade: item.prioridade || 'Média',
        status: item.status || 'A Fazer',
        dataCriacao: item.data_criacao || '',
        prazo: item.prazo || '',
        tempo: item.tempo || ''
      }));
    }
  } catch (e) {
    console.error(e);
  }

  return carregarCardsLocais();
}

function carregarCardsLocais() {
  try {
    if (fs.existsSync(KANBAN_FILE)) {
      const data = fs.readFileSync(KANBAN_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error(e);
  }
  return [];
}

function salvarCardsLocais(cards) {
  try {
    fs.writeFileSync(KANBAN_FILE, JSON.stringify(cards, null, 2), 'utf8');
  } catch (e) {
    console.error(e);
  }
}

router.get('/api/kanban', async (req, res) => {
  const cards = await carregarCards();
  res.json({ status: 'success', data: cards });
});

router.post('/api/kanban', async (req, res) => {
  const { action } = req.body;
  let cards = await carregarCards();

  if (action === 'add_kanban') {
    const novoCard = {
      id: req.body.id || `K-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      titulo: req.body.titulo || '',
      descricao: req.body.descricao || '',
      projeto: req.body.projeto || '',
      assuntoInterno: req.body.assunto_interno || req.body.assuntoInterno || '',
      classNivel1: req.body.classNivel1 || req.body.class1 || '',
      classNivel2: req.body.classNivel2 || req.body.class2 || '',
      prioridade: req.body.prioridade || 'Média',
      status: req.body.status || 'A Fazer',
      dataCriacao: new Date().toISOString().split('T')[0],
      prazo: req.body.prazo || '',
      tempo: req.body.tempo || ''
    };
    cards.unshift(novoCard);
    salvarCardsLocais(cards);

    try {
      await supabase.from('kanban_cards').upsert({
        id: novoCard.id,
        titulo: novoCard.titulo,
        descricao: novoCard.descricao,
        projeto: novoCard.projeto,
        assunto_interno: novoCard.assuntoInterno,
        class_nivel_1: novoCard.classNivel1,
        class_nivel_2: novoCard.classNivel2,
        prioridade: novoCard.prioridade,
        status: novoCard.status,
        data_criacao: novoCard.dataCriacao,
        prazo: novoCard.prazo,
        tempo: novoCard.tempo,
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.error(e);
    }

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_kanban',
        titulo: novoCard.titulo,
        descricao: novoCard.descricao,
        projeto: novoCard.projeto,
        assunto_interno: novoCard.assuntoInterno,
        classNivel1: novoCard.classNivel1,
        classNivel2: novoCard.classNivel2,
        prioridade: novoCard.prioridade,
        prazo: novoCard.prazo,
        status: novoCard.status
      })
    }).catch(err => console.error(err));

    return res.json({ status: 'success', id: novoCard.id, data: novoCard });
  }

  if (action === 'update_kanban_status') {
    const { id, status } = req.body;
    const card = cards.find(c => c.id === id);
    if (card) {
      card.status = status;
      salvarCardsLocais(cards);
    }

    try {
      await supabase.from('kanban_cards').update({
        status: status,
        updated_at: new Date().toISOString()
      }).eq('id', id);
    } catch (e) {
      console.error(e);
    }

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_kanban_status', id, status })
    }).catch(err => console.error(err));

    return res.json({ status: 'success' });
  }

  if (action === 'delete_kanban') {
    const { id } = req.body;
    cards = cards.filter(c => c.id !== id);
    salvarCardsLocais(cards);

    try {
      await supabase.from('kanban_cards').delete().eq('id', id);
    } catch (e) {
      console.error(e);
    }

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_kanban', id })
    }).catch(err => console.error(err));

    return res.json({ status: 'success' });
  }

  if (action === 'complete_kanban') {
    const { id, tempo, classNivel1, classNivel2 } = req.body;
    const card = cards.find(c => c.id === id);
    if (card) {
      card.status = 'Concluído';
      if (classNivel1) card.classNivel1 = classNivel1;
      if (classNivel2) card.classNivel2 = classNivel2;
      if (tempo) card.tempo = tempo;
      salvarCardsLocais(cards);
    }

    const updateSupabase = {
      status: 'Concluído',
      updated_at: new Date().toISOString()
    };
    if (classNivel1) updateSupabase.class_nivel_1 = classNivel1;
    if (classNivel2) updateSupabase.class_nivel_2 = classNivel2;
    if (tempo) updateSupabase.tempo = tempo;

    try {
      await supabase.from('kanban_cards').update(updateSupabase).eq('id', id);
    } catch (e) {
      console.error(e);
    }

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'complete_kanban',
        id,
        tempo,
        classNivel1,
        classNivel2
      })
    }).catch(err => console.error(err));

    return res.json({ status: 'success' });
  }

  if (action === 'edit_kanban' || action === 'update_kanban') {
    const { id, titulo, descricao, projeto, assunto_interno, assuntoInterno, classNivel1, class1, classNivel2, class2, prioridade, prazo, status } = req.body;
    const card = cards.find(c => c.id === id);
    if (card) {
      if (titulo !== undefined) card.titulo = titulo;
      if (descricao !== undefined) card.descricao = descricao;
      if (projeto !== undefined) card.projeto = projeto;
      if (assunto_interno !== undefined || assuntoInterno !== undefined) {
        card.assuntoInterno = assunto_interno || assuntoInterno || '';
      }
      if (classNivel1 !== undefined || class1 !== undefined) {
        card.classNivel1 = classNivel1 || class1 || '';
      }
      if (classNivel2 !== undefined || class2 !== undefined) {
        card.classNivel2 = classNivel2 || class2 || '';
      }
      if (prioridade !== undefined) card.prioridade = prioridade;
      if (prazo !== undefined) card.prazo = prazo;
      if (status !== undefined) card.status = status;
      salvarCardsLocais(cards);
    }

    const updateSupabase = { updated_at: new Date().toISOString() };
    if (titulo !== undefined) updateSupabase.titulo = titulo;
    if (descricao !== undefined) updateSupabase.descricao = descricao;
    if (projeto !== undefined) updateSupabase.projeto = projeto;
    if (assunto_interno !== undefined || assuntoInterno !== undefined) {
      updateSupabase.assunto_interno = assunto_interno || assuntoInterno || '';
    }
    if (classNivel1 !== undefined || class1 !== undefined) {
      updateSupabase.class_nivel_1 = classNivel1 || class1 || '';
    }
    if (classNivel2 !== undefined || class2 !== undefined) {
      updateSupabase.class_nivel_2 = classNivel2 || class2 || '';
    }
    if (prioridade !== undefined) updateSupabase.prioridade = prioridade;
    if (prazo !== undefined) updateSupabase.prazo = prazo;
    if (status !== undefined) updateSupabase.status = status;

    try {
      await supabase.from('kanban_cards').update(updateSupabase).eq('id', id);
    } catch (e) {
      console.error(e);
    }

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'edit_kanban',
        id,
        titulo,
        descricao,
        projeto,
        assunto_interno: assunto_interno || assuntoInterno || '',
        classNivel1: classNivel1 || class1 || '',
        classNivel2: classNivel2 || class2 || '',
        prioridade,
        prazo,
        status
      })
    }).catch(err => console.error(err));

    return res.json({ status: 'success', data: card });
  }

  res.status(400).json({ error: 'Ação inválida' });
});

router.post('/api/transcrever-kanban', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const userId = req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
  let openAiConfig;
  try {
    openAiConfig = await obterClienteOpenAI(userId);
  } catch (errSetup) {
    return res.status(400).json({ error: errSetup.message });
  }

  try {
    const audioFile = await toFile(req.file.buffer, req.file.originalname || 'audio.webm', {
      type: req.file.mimetype || 'audio/webm'
    });

    const transcricao = await openAiConfig.openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt',
      response_format: 'json',
    });

    const textoCompleto = transcricao.text ? transcricao.text.trim() : '';

    if (!textoCompleto) {
      return res.status(400).json({ error: 'Nenhuma fala foi identificada no áudio. Fale mais próximo ao microfone e tente novamente.' });
    }

    const opcoes = await opcoesRepository.carregar();
    const { projetosStr, assuntosStr, classificacoesStr } = formatarListasParaPrompt(opcoes);

    const systemPrompt = `Você é um assistente de gestão de projetos que extrai TAREFAS PENDENTES a partir de áudio para um Quadro Kanban.
O usuário vai ditar tarefas que PRECISAM SER FEITAS (não são atividades já concluídas).

Sua tarefa é interpretar o texto e retornar APENAS um objeto JSON válido com a seguinte estrutura:

{
  "tarefas": [
    {
      "titulo": "Título curto, executivo e acionável da tarefa (máximo 8 palavras, comece preferencialmente com verbo no infinitivo: Implementar, Corrigir, Revisar, Configurar, etc.)",
      "descricao": "Descrição detalhada do que precisa ser feito, com contexto relevante em terceira pessoa.",
      "projeto": "SELECIONE OBRIGATORIAMENTE um projeto corporativo da lista abaixo. Se não mencionado ou incerto, use 'Interno' ou deixe vazio.",
      "assunto_interno": "SELECIONE OBRIGATORIAMENTE um 'Assunto Interno' da 'Lista de assuntos internos válidos' no final deste prompt. Não invente assuntos novos, selecione o mais correspondente da lista.",
      "classNivel1": "SELECIONE OBRIGATORIAMENTE uma 'Classificação nível 1' a partir da lista fornecida abaixo.",
      "classNivel2": "SELECIONE OBRIGATORIAMENTE uma 'Classificação nível 2' que corresponda à 'Classificação nível 1' escolhida, baseando-se EXATAMENTE nas combinações da lista abaixo.",
      "prioridade": "Alta, Média ou Baixa (infira pela urgência e tom do áudio, use Média como padrão)",
      "prazo": "Data no formato YYYY-MM-DD se mencionada no áudio, ou vazio se não houver"
    }
  ]
}

Se o usuário mencionar MÚLTIPLAS tarefas, divida e extraia TODAS como itens separados no array.
Se mencionar apenas UMA tarefa, retorne um array com 1 item.

Lista de projetos válidos (retorne exatamente como escrito aqui):
${projetosStr}

Lista de assuntos internos válidos (retorne exatamente como escrito aqui):
${assuntosStr}

Lista de combinações válidas de Classificação nível 1 / Classificação nível 2 (escolha exatamente um par desta lista):
${classificacoesStr}

Regras fonéticas e de correção:
- Corrija "Process" ou "Proces" para "Prosis".
- Corrija "Via Mar" para "Viamar".
- Corrija "Rede Pro" para "Rede Pró".

Retorne APENAS o JSON, sem formatação markdown ou textos adicionais.`;

    let jsonResult = null;
    try {
      const completions = await chamarModeloComFallback({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Texto transcrito:\n"${textoCompleto}"` },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      }, openAiConfig.openai, openAiConfig.modelos);

      let respostaTexto = completions.choices[0].message.content.trim();
      respostaTexto = respostaTexto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      if (respostaTexto.startsWith('```json')) {
        respostaTexto = respostaTexto.replace(/^```json/i, '').replace(/```$/i, '').trim();
      } else if (respostaTexto.startsWith('```')) {
        respostaTexto = respostaTexto.replace(/^```/i, '').replace(/```$/i, '').trim();
      }

      try {
        jsonResult = JSON.parse(respostaTexto);
      } catch (e) {
        const firstBrace = respostaTexto.indexOf('{');
        const lastBrace = respostaTexto.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            jsonResult = JSON.parse(respostaTexto.substring(firstBrace, lastBrace + 1));
          } catch (errParse) {
            jsonResult = null;
          }
        }
      }
    } catch (errIa) {
      console.error('Falha nos modelos de IA para Kanban:', errIa);
    }

    if (!jsonResult || !Array.isArray(jsonResult.tarefas) || jsonResult.tarefas.length === 0) {
      jsonResult = {
        tarefas: [{
          titulo: 'Nova Tarefa Registrada',
          descricao: 'Demanda capturada via áudio para detalhamento e execução.',
          projeto: 'Interno',
          assunto_interno: '',
          classNivel1: '',
          classNivel2: '',
          prioridade: 'Média',
          prazo: ''
        }]
      };
    }

    let cards = await carregarCards();
    const tarefasSalvas = [];
    const hojeStr = new Date().toISOString().split('T')[0];

    for (const tarefa of (jsonResult.tarefas || [jsonResult])) {
      const novoCard = {
        id: `K-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        titulo: tarefa.titulo || 'Nova Tarefa',
        descricao: tarefa.descricao || '',
        projeto: tarefa.projeto || '',
        assuntoInterno: tarefa.assunto_interno || tarefa.assuntoInterno || '',
        classNivel1: tarefa.classNivel1 || '',
        classNivel2: tarefa.classNivel2 || '',
        prioridade: tarefa.prioridade || 'Média',
        status: 'A Fazer',
        dataCriacao: hojeStr,
        prazo: tarefa.prazo || '',
        tempo: ''
      };

      cards.unshift(novoCard);
      tarefasSalvas.push(novoCard);

      try {
        await supabase.from('kanban_cards').upsert({
          id: novoCard.id,
          titulo: novoCard.titulo,
          descricao: novoCard.descricao,
          projeto: novoCard.projeto,
          assunto_interno: novoCard.assuntoInterno,
          class_nivel_1: novoCard.classNivel1,
          class_nivel_2: novoCard.classNivel2,
          prioridade: novoCard.prioridade,
          status: 'A Fazer',
          data_criacao: novoCard.dataCriacao,
          prazo: novoCard.prazo,
          tempo: '',
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.error(e);
      }

      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_kanban',
          titulo: novoCard.titulo,
          descricao: novoCard.descricao,
          projeto: novoCard.projeto,
          assunto_interno: novoCard.assuntoInterno,
          classNivel1: novoCard.classNivel1,
          classNivel2: novoCard.classNivel2,
          prioridade: novoCard.prioridade,
          prazo: novoCard.prazo,
          status: 'A Fazer'
        })
      }).catch(err => console.error(err));
    }

    salvarCardsLocais(cards);

    res.json({ tarefas: tarefasSalvas });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar áudio para Kanban.' });
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
    openAiConfig = await obterClienteOpenAI(userId);
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


    const completions = await chamarModeloComFallback({
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
    openAiConfig = await obterClienteOpenAI(userId);
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

    const completions = await chamarModeloComFallback({
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
    openAiConfig = await obterClienteOpenAI(userId);
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

    const completions = await chamarModeloComFallback({
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
