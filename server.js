import express from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { supabase, supabaseAdmin } from './supabaseClient.js';
async function verificarAdmin(req, res, next) {
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

const app = express();
const port = 5555;
const openaiGlobal = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxzPiZ7Dv2aUgT-ues0F8Q9UeSlVScUCJY2DLgyo1DxsTSjD9Lu4_SsaGD1P5gYvrEh_w/exec';
const OPCOES_FILE = path.join(process.cwd(), 'opcoes_sistema.json');

const OPCOES_DEFAULT = {
  assuntosInternos: [
    "Prosis", "Viamar", "Infraestrutura", "Rede Pró", "Suporte", "Scraping",
    "Árvore de Categorias", "Automação", "Gestão", "Atendimento", "Integração API"
  ],
  projetos: [
    "Interno", "SMB - CBA Diesel", "Projetos - Rede Pró", "Projetos - Agrominas",
    "Projetos - Wurth", "Projetos - Campneus", "Projetos - Fortbras", "Projetos - CDC",
    "Projetos - Prometeon", "Projetos - Tracbel", "Fabricantes - Unimil", "Fabricantes - Círculo",
    "Projetos - Rodobens", "Projetos - Leo Madeira", "Fabricantes - Intercoffee",
    "Projetos - Bunge", "SMB - Rasec", "Projetos - Broto"
  ],
  classificacoes: {
    "Cadastro": [
      "Avaliação de dados recebidos", "Contato com fabricantes", "Contato com lojista",
      "Scraping", "Tratamento de SKU", "Tratamento de imagem", "Tratamento de aplicações",
      "Reunião com cliente", "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Gerenciamento de projeto": [
      "Criação de relatório", "Reunião com cliente", "Reunião sobre projeto", "Suporte ao cliente",
      "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Infraestrutura": [
      "Categorias", "Base de veículos", "Cadastro de fabricantes", "Reunião com cliente",
      "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Matching": [
      "Cadastro de sinônimos de nome de fabricante ou código de peça", "Reunião com cliente",
      "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Qualidade": [
      "Personalização de cadastro", "Correção de cadastro errado (Recebemos a informação correta e erramos na manipulação)",
      "Reunião com cliente", "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Orçamento": [ "Orçamento" ],
    "Reunião que não é sobre a atividade [Projeto deve ser interno]": [ "Reunião interna" ],
    "Gestão de pessoas": [
      "Contratação / Feedback / Estratégia do dpto e etc", "Grestão de equipe, tarefas e demandas"
    ],
    "Scraping": [ "Scraping" ],
    "Sugestão e/ou Curadoria de Mídias CdP": [ "Sugestão e/ou Curadoria de Mídias CdP" ],
    "Automação": [ "Scraping", "Tratamento de Vista Explodida" ]
  }
};

async function carregarOpcoes() {
  try {
    const { data, error } = await supabaseAdmin
      .from('opcoes_sistema')
      .select('dados')
      .eq('id', 'padrao')
      .single();
    if (!error && data && data.dados) {
      return data.dados;
    }
  } catch (e) {
    console.error(e);
  }

  try {
    if (fs.existsSync(OPCOES_FILE)) {
      const data = fs.readFileSync(OPCOES_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.assuntosInternos) && Array.isArray(parsed.projetos) && parsed.classificacoes) {
        return parsed;
      }
    }
  } catch (e) {
    console.error(e);
  }
  await salvarOpcoes(OPCOES_DEFAULT);
  return OPCOES_DEFAULT;
}

async function salvarOpcoes(opcoes) {
  try {
    await supabaseAdmin
      .from('opcoes_sistema')
      .upsert({ id: 'padrao', dados: opcoes, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error(e);
  }

  try {
    fs.writeFileSync(OPCOES_FILE, JSON.stringify(opcoes, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function formatarListasParaPrompt(opcoes) {
  const listaProjetos = (opcoes.projetos || []).map(p => `- ${p}`).join('\n');
  const listaAssuntos = (opcoes.assuntosInternos || []).map(a => `- ${a}`).join('\n');
  const combinacoes = [];
  const classMap = opcoes.classificacoes || {};
  for (const c1 of Object.keys(classMap)) {
    const subs = classMap[c1];
    if (Array.isArray(subs) && subs.length > 0) {
      subs.forEach(c2 => combinacoes.push(`- ${c1} / ${c2}`));
    } else {
      combinacoes.push(`- ${c1}`);
    }
  }
  return {
    projetosStr: listaProjetos,
    assuntosStr: listaAssuntos,
    classificacoesStr: combinacoes.join('\n')
  };
}

app.get('/api/opcoes', async (req, res) => {
  const opcoes = await carregarOpcoes();
  res.json({ status: 'success', data: opcoes });
});

app.post('/api/opcoes', async (req, res) => {
  const { action } = req.body;
  const opcoes = await carregarOpcoes();

  if (action === 'salvar_tudo') {
    const { dados } = req.body;
    if (dados && Array.isArray(dados.assuntosInternos) && Array.isArray(dados.projetos) && dados.classificacoes) {
      await salvarOpcoes(dados);
      return res.json({ status: 'success', data: dados });
    }
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  if (action === 'adicionar_assunto') {
    const novo = (req.body.item || '').trim();
    if (novo && !opcoes.assuntosInternos.includes(novo)) {
      opcoes.assuntosInternos.push(novo);
      await salvarOpcoes(opcoes);
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'editar_assunto') {
    const antigo = (req.body.antigo || '').trim();
    const novo = (req.body.novo || '').trim();
    if (antigo && novo) {
      const idx = opcoes.assuntosInternos.indexOf(antigo);
      if (idx !== -1) {
        opcoes.assuntosInternos[idx] = novo;
        await salvarOpcoes(opcoes);
      }
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'excluir_assunto') {
    const item = (req.body.item || '').trim();
    opcoes.assuntosInternos = opcoes.assuntosInternos.filter(a => a !== item);
    await salvarOpcoes(opcoes);
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'adicionar_projeto') {
    const novo = (req.body.item || '').trim();
    if (novo && !opcoes.projetos.includes(novo)) {
      opcoes.projetos.push(novo);
      await salvarOpcoes(opcoes);
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'editar_projeto') {
    const antigo = (req.body.antigo || '').trim();
    const novo = (req.body.novo || '').trim();
    if (antigo && novo) {
      const idx = opcoes.projetos.indexOf(antigo);
      if (idx !== -1) {
        opcoes.projetos[idx] = novo;
        await salvarOpcoes(opcoes);
      }
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'excluir_projeto') {
    const item = (req.body.item || '').trim();
    opcoes.projetos = opcoes.projetos.filter(p => p !== item);
    await salvarOpcoes(opcoes);
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'adicionar_class1') {
    const c1 = (req.body.class1 || '').trim();
    if (c1 && !opcoes.classificacoes[c1]) {
      opcoes.classificacoes[c1] = [];
      await salvarOpcoes(opcoes);
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'editar_class1') {
    const antigo = (req.body.antigo || '').trim();
    const novo = (req.body.novo || '').trim();
    if (antigo && novo && antigo !== novo && opcoes.classificacoes[antigo]) {
      opcoes.classificacoes[novo] = opcoes.classificacoes[antigo];
      delete opcoes.classificacoes[antigo];
      await salvarOpcoes(opcoes);
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'excluir_class1') {
    const c1 = (req.body.class1 || '').trim();
    if (c1 && opcoes.classificacoes[c1]) {
      delete opcoes.classificacoes[c1];
      await salvarOpcoes(opcoes);
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'adicionar_class2') {
    const c1 = (req.body.class1 || '').trim();
    const c2 = (req.body.class2 || '').trim();
    if (c1 && c2 && opcoes.classificacoes[c1]) {
      if (!opcoes.classificacoes[c1].includes(c2)) {
        opcoes.classificacoes[c1].push(c2);
        await salvarOpcoes(opcoes);
      }
    }
    return res.json({ status: 'success', data: opcoes });
  }

  if (action === 'excluir_class2') {
    const c1 = (req.body.class1 || '').trim();
    const c2 = (req.body.class2 || '').trim();
    if (c1 && c2 && opcoes.classificacoes[c1]) {
      opcoes.classificacoes[c1] = opcoes.classificacoes[c1].filter(sub => sub !== c2);
      await salvarOpcoes(opcoes);
    }
    return res.json({ status: 'success', data: opcoes });
  }

  res.status(400).json({ error: 'Ação de opções inválida' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (authError || !authData.user) {
      return res.status(401).json({ error: authError ? authError.message : 'Credenciais inválidas.' });
    }

    const { data: usuario, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, email, nome, is_admin, permissoes')
      .eq('id', authData.user.id)
      .single();

    if (userError || !usuario) {
      return res.status(403).json({ error: 'Usuário não cadastrado na base de acesso.' });
    }

    return res.json({
      status: 'success',
      session: authData.session,
      user: usuario
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
});

app.post('/api/admin/usuarios', verificarAdmin, async (req, res) => {
  const { email, password, nome, permissoes } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  try {
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { nome: nome || '' }
    });

    if (createError) {
      return res.status(400).json({ error: createError.message });
    }

    const novoUsuario = {
      id: createData.user.id,
      email: createData.user.email,
      nome: nome || '',
      is_admin: false,
      permissoes: permissoes || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: dbError } = await supabaseAdmin
      .from('usuarios')
      .insert(novoUsuario);

    if (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(createData.user.id);
      return res.status(500).json({ error: dbError.message });
    }

    return res.json({
      status: 'success',
      user: novoUsuario
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

app.get('/api/admin/usuarios', verificarAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('usuarios')
      .select('id, email, nome, is_admin, permissoes, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ status: 'success', data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

app.delete('/api/admin/usuarios/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await supabaseAdmin.auth.admin.deleteUser(id);
    await supabaseAdmin.from('usuarios').delete().eq('id', id);
    return res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

app.get('/api/setup/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('setup_usuario')
      .select('openai_api_key, openai_model')
      .eq('user_id', userId)
      .single();

    if (error || !data || !data.openai_api_key) {
      return res.json({
        status: 'success',
        configured: false,
        openai_model: data?.openai_model || 'gpt-4o-mini'
      });
    }

    return res.json({
      status: 'success',
      configured: true,
      apiKeyMasked: `sk-...${data.openai_api_key.slice(-4)}`,
      openai_model: data.openai_model || 'gpt-4o-mini'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao consultar setup.' });
  }
});

app.post('/api/setup', async (req, res) => {
  const { userId, openai_api_key, openai_model } = req.body;
  const targetUserId = userId || req.headers['x-user-id'] || req.headers['user-id'];

  if (!targetUserId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  if (!openai_api_key) {
    return res.status(400).json({ error: 'openai_api_key é obrigatória.' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('setup_usuario')
      .upsert({
        user_id: targetUserId,
        openai_api_key: openai_api_key.trim(),
        openai_model: openai_model || 'gpt-4o-mini',
        updated_at: new Date().toISOString()
      });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ status: 'success', message: 'Setup atualizado com sucesso.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao salvar setup do usuário.' });
  }
});

app.post('/api/transcrever', upload.single('audio'), async (req, res) => {
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

    const opcoes = await carregarOpcoes();
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

app.get('/api/kanban', async (req, res) => {
  const cards = await carregarCards();
  res.json({ status: 'success', data: cards });
});

app.post('/api/kanban', async (req, res) => {
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

app.post('/api/transcrever-kanban', upload.single('audio'), async (req, res) => {
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

    const opcoes = await carregarOpcoes();
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


app.post('/api/gerar-relatorio', async (req, res) => {
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
    const sheetRes = await fetch(`${WEBHOOK_URL}?action=semana-relatorio&semana=${encodeURIComponent(semana)}`);
    const sheetData = await sheetRes.json();

    if (sheetData.status !== 'success' || !sheetData.atividades || sheetData.atividades.length === 0) {
      return res.json({ status: 'empty', resumo: [], message: 'Nenhuma atividade encontrada para esta semana.' });
    }

    const agrupado = {};
    for (const atv of sheetData.atividades) {
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

app.post('/api/gerar-relatorio-reporter', async (req, res) => {
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
    const sheetRes = await fetch(`${WEBHOOK_URL}?action=semana-relatorio&semana=${encodeURIComponent(semana)}`);
    const sheetData = await sheetRes.json();

    if (sheetData.status !== 'success' || !sheetData.atividades || sheetData.atividades.length === 0) {
      return res.json({ status: 'empty', quadrantes: [], message: 'Nenhuma atividade encontrada para esta semana.' });
    }

    const agrupado = {};
    for (const atv of sheetData.atividades) {
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

app.post('/api/processar-reuniao', async (req, res) => {
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
        } catch(errParse) {
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

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
}

export default app;
