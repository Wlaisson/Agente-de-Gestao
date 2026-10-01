# Roadmap — Memória, Autoridade e Voz

Documento de desenho para a próxima fase do sistema multiagente.
Pré-requisito de leitura: `docs/HANDOFF_AGENTES_A2A.md`.

Escrito para ser executado por quem não acompanhou a conversa que o originou.

---

## 0. Resumo honesto: o que já existe, o que está quebrado, o que é novo

A ideia se divide em três frentes, e elas **não estão no mesmo estágio**. Misturar
isso levaria a reimplementar o que já funciona e a subestimar o que falta.

| Frente | Situação real hoje |
|---|---|
| **Memória da conversa** (curto prazo) | **Quebrada.** O chat não lembra de nada entre uma mensagem e a seguinte. Correção pequena, alto impacto. |
| **Memória de longo prazo** (preferências, apelidos, fatos) | **Não existe.** É a parte genuinamente nova e a que tem as decisões difíceis. |
| **Memória semântica das atividades** | **Já existe.** pgvector + `buscar_atividades_semelhantes`. Nada a fazer. |
| **Autoridade para gerar coisas** (criar card etc.) | **Já existe**, com 3 ações e portão de confirmação. Falta *ampliar* com segurança. |
| **Conversa por voz** | **Não existe no chat**, mas a transcrição já existe no app. É montagem, não construção. |

A conclusão que importa: **"dar autoridade ao agente para criar um card" já está pronto.**
Teste hoje — peça "anota uma tarefa pra revisar o catálogo da Wurth até sexta" e o
cartão de confirmação aparece. O trabalho futuro é ampliar o repertório e reduzir
a fricção sem perder a segurança.

---

## 1. A falha atual: o chat não tem memória entre turnos

### Sintoma
```
Você:  quanto tempo gastei essa semana na Imdepa?
Agente: Nesta semana (28/09 a 04/10) você registrou 6h15 na Imdepa.
Você:  e na Tracbel?
Agente: (não sabe do que você está falando — perdeu "essa semana" e o assunto)
```

### Causa
Em `application/agents/runtime/TaskManager.js`, quando chega uma mensagem nova num
contexto cuja tarefa anterior já terminou:

```js
if (ehEstadoTerminal(tarefa.status.state)) {
  // Tarefa encerrada nao revive: a mensagem abre uma tarefa nova no
  // MESMO contexto, preservando o fio da conversa.   ← o comentário mente
  contextId = tarefa.contextId;
  tarefa = null;
}
...
tarefa = criarTarefa({ contextId, ..., mensagemInicial: mensagem });  // history: [mensagem]
```

O `contextId` é preservado, mas o **histórico não**. E
`criarAgenteLlm.reconstruirMensagens()` só lê `tarefa.history`, que tem uma mensagem só.

`SupabaseTarefaA2ARepository.listarPorContexto()` foi escrito exatamente para isso
e **nunca é chamado por ninguém** (confirmado por busca no repositório).

### Correção — Camada 1

Em `TaskManager.enviarMensagem`, ao criar tarefa num contexto que já existe, carregar
o histórico das tarefas anteriores:

```js
const anteriores = await tarefaRepository.listarPorContexto(contextId, userId);
const historicoPrevio = anteriores.flatMap(t => t.history);
tarefa = criarTarefa({ contextId, agentId, userId, mensagemInicial: mensagem });
tarefa = { ...tarefa, history: [...historicoPrevio, mensagem] };
```

**Cuidados:**

1. **Teto de contexto.** `criarAgenteLlm` já corta em `MAX_MENSAGENS_HISTORICO = 12`.
   Com histórico real esse corte passa a valer de verdade — conversa longa vai
   perder o começo. Aceitável na v1; ver Camada 1.5 abaixo.
2. **Custo.** Cada turno passa a mandar mais tokens. Numa conversa de 10 turnos, o
   prompt do orquestrador quase dobra.
3. **Sub-tarefas de delegação poluem.** `listarPorContexto` traz TAMBÉM as tarefas
   dos especialistas (elas usam o mesmo `contextId`). Filtre por
   `metadata.parentTaskId == null`, senão o orquestrador vai ler as próprias
   delegações como se fossem fala do usuário.
4. **Mensagem de sistema não entra.** Só `role: user` e `role: agent`.

**Esforço:** ~2h com teste. **Impacto:** alto — é o que faz o chat parecer um chat.

### Camada 1.5 — Sumarização do fio (depois, se necessário)

Quando o histórico passar do teto, em vez de cortar o começo, resumir as mensagens
antigas num parágrafo e manter as últimas na íntegra. Guardar o resumo em
`tarefa.metadata.resumoAnterior`.

Só faça isso quando o corte virar problema observado. Sumarização prematura perde
detalhe que ninguém pediu para perder.

---

## 2. Memória de longo prazo — a parte nova

### O problema que resolve

Hoje o agente sabe **o que você registrou**. Não sabe **quem você é**:

- que "rede pro" é o jeito como você chama `Projetos - Rede Pró`;
- que "o slide" quer dizer o de Agentes de Catálogo;
- que no Weekly você não usa a seção de riscos;
- que o Gustavo é seu par no agente de catálogo;
- que a Imdepa tem contrato de 5.000 ações/mês.

Cada conversa recomeça do zero. Você reexplica as mesmas coisas.

### Três tipos, com tratamento diferente

| Tipo | Exemplo | Como entra no prompt |
|---|---|---|
| **Preferência** | "no weekly, não coloca a seção de riscos" | **Sempre**, todas elas. São poucas e precisam valer em toda resposta. |
| **Vocabulário** | "'rede pro' = Projetos - Rede Pró" | **Sempre.** Alimenta também o `ResolverEntidade` como sinônimo. |
| **Fato de trabalho** | "Imdepa: contrato de 5.000 ações/mês" | **Por relevância** — busca semântica sobre o pedido, top 3–5. |

A separação importa: preferência que só entra "quando relevante" é preferência
que falha justamente quando importava.

### Como capturar — comece SÓ pelo explícito

Dois caminhos possíveis:

**a) Explícito (recomendado para a v1).** O usuário diz "lembra que..." / "sempre
que eu pedir X, faz Y". Vira uma **proposta de memória**, que passa pelo mesmo
portão de confirmação das outras escritas.

**b) Extração automática.** Um agente "memorista" lê a conversa encerrada e extrai
candidatos.

**Recomendação forte: não faça (b) na primeira versão.** Uma memória extraída
errada envenena *todas* as conversas seguintes, e o usuário não tem como saber de
onde veio o comportamento estranho. É o tipo de bug que destrói confiança no
sistema inteiro. Quando fizer, extração entra com `confianca: 'baixa'` e só é
promovida depois de confirmada em uso.

### Onde guardar

```sql
create table if not exists a2a_memorias (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  tipo text not null,                -- 'preferencia' | 'vocabulario' | 'fato'
  chave text,                        -- "weekly.secao_riscos", "apelido.rede pro"
  valor text not null,
  origem text not null default 'explicita',   -- 'explicita' | 'extraida'
  confianca text not null default 'alta',     -- 'alta' | 'baixa'
  contexto_origem text,              -- contextId da conversa que a gerou
  ativa boolean not null default true,
  usos int not null default 0,
  ultimo_uso_em timestamptz,
  criado_em timestamptz not null default timezone('utc'::text, now()),
  atualizado_em timestamptz not null default timezone('utc'::text, now()),
  embedding vector(1536)             -- só usado para tipo='fato'
);

create index if not exists idx_a2a_memorias_user on a2a_memorias(user_id, tipo) where ativa;
create index if not exists idx_a2a_memorias_emb on a2a_memorias using hnsw (embedding vector_cosine_ops);
```

`chave` permite substituir uma preferência em vez de acumular duas contraditórias.
`ativa` em vez de `DELETE`: memória removida vira histórico, não some.

### Como esquecer — a parte que todo mundo esquece de projetar

Um sistema que só acumula memória fica pior com o tempo. Quatro mecanismos:

1. **Contradição.** Memória nova com a mesma `chave` de uma existente → o agente
   mostra as duas e pergunta qual vale. Nunca sobrescreve em silêncio.
2. **Remoção pedida.** "esquece que eu não uso a seção de riscos" → proposta de
   desativação, com confirmação.
3. **Desuso.** Memória sem uso há muito tempo entra numa lista de revisão. **Não
   desative sozinho** — o usuário pode ter passado três meses sem tocar num cliente.
4. **Tela de gestão — obrigatória, não opcional.** O usuário precisa ver e editar
   tudo que o sistema lembra dele. Memória invisível que muda o comportamento é a
   pior experiência possível: o agente age "estranho" e não há como descobrir por quê.
   Sugestão: sub-aba em **Gerenciar**, com filtro por tipo e link para a conversa
   que originou cada item.

### Como entra no prompt

Em `criarAgenteLlm`, no bloco `contextoOperacional`:

```
Memória sobre este usuário (ele confirmou cada item; respeite sem precisar perguntar):
- Preferência: no Weekly, não incluir a seção de riscos.
- Vocabulário: quando ele diz "rede pro", refere-se a "Projetos - Rede Pró".
- Fato: Imdepa opera com contrato de 5.000 ações/mês.
```

**Uma negativa é obrigatória junto:**
> *A memória diz como trabalhar e como interpretar o que ele fala. Ela NUNCA é fonte
> de número, data ou atividade — isso vem sempre de ferramenta.*

Sem isso, o modelo vai citar um número que "lembra" da memória como se fosse dado
do banco. Seria a invariante nº 1 do sistema quebrada pela porta dos fundos.

### Integração com o `ResolverEntidade`

Memória de vocabulário deve alimentar `domain/services/ResolverEntidade.js` como
lista de sinônimos, não só o prompt. Assim "rede pro" resolve **deterministicamente**,
sem depender de o modelo lembrar. Regra de precedência: sinônimo aprendido ganha do
casamento por heurística; empate entre dois sinônimos continua sendo ambiguidade.

### Esforço estimado
- Schema + repositório + ferramentas de propor/listar memória: **1–2 dias**
- Injeção no prompt + integração com `ResolverEntidade`: **1 dia**
- Tela de gestão: **1 dia**
- Extração automática (fase 2): **2–3 dias**

---

## 3. Autoridade do agente

### O que já funciona

Três ações, todas com proposta + confirmação (`docs/HANDOFF_AGENTES_A2A.md`, seção 3.3):

| Ação | Agente | Impacto |
|---|---|---|
| `criar_tarefa` | planejador | baixo |
| `mover_tarefa` | planejador | baixo / médio ao concluir |
| `registrar_atividade` | registro | **alto** (alimenta todo relatório futuro) |

O mecanismo é genérico: um tipo novo de ação é uma ferramenta `escrita: true` que
devolve `resultadoProposta(...)` mais um executor em `composicao.js`. Não há
arquitetura nova a inventar.

### Ampliação natural

| Ação nova | Complexidade | Observação |
|---|---|---|
| `editar_atividade` | baixa | `AtualizarAtividadeUseCase` já existe |
| `concluir_card_com_tempo` | baixa | `ConcluirCardUseCase` já existe |
| `criar_varias_tarefas` | média | Uma confirmação para o lote todo |
| `excluir_atividade` | média | Impacto alto; exigir confirmação sempre |
| `registrar_semana_inteira` | alta | Vários registros de uma vez, a partir de um relato longo |

### Níveis de autoridade — como reduzir fricção sem perder segurança

Confirmar toda ação cansa. Mas remover a confirmação sem rede é como o sistema
começa a corromper dados. A saída é **desfazer**, não confiança cega.

Proposta: configuração por usuário, em Setup.

| Nível | Comportamento |
|---|---|
| **Cauteloso** (padrão) | Confirma tudo. É o comportamento de hoje. |
| **Equilibrado** | Executa ações de impacto **baixo** direto, mostrando "feito — desfazer". Confirma médio e alto. |
| **Ágil** | Executa baixo e médio com desfazer. Confirma só impacto alto (registrar/excluir atividade). |

**Pré-requisito inegociável: desfazer precisa existir ANTES do nível Equilibrado.**
A `a2a_auditoria` já grava `detalhes` e `executado` de cada ação — é a base. Falta
a operação inversa por tipo:

| Ação | Inverso |
|---|---|
| `criar_tarefa` | excluir o card criado |
| `mover_tarefa` | voltar ao `statusAnterior` (já está gravado na proposta) |
| `registrar_atividade` | excluir a atividade criada |

Janela sugerida: desfazer disponível enquanto a conversa estiver aberta, com botão
na própria mensagem.

**Nunca promova `registrar_atividade` para execução automática**, em nenhum nível.
Uma atividade errada contamina silenciosamente todo relatório, resumo semanal e
soma de tempo que vier depois — e ninguém percebe até a apresentação.

### Ações proativas (fase posterior)

O agente notar algo e sugerir sem ser perguntado: "você tem 3 tarefas vencendo esta
semana", "faltou registrar atividade na quinta". Exige um gatilho agendado, não
conversacional, e uma política clara de frequência. Deixe para depois de memória e
voz — o valor por unidade de esforço é menor.

---

## 4. Conversa por voz

### O que já existe no app

- `OpenAIGateway.transcreverAudio()` — whisper-1, `language: 'pt'`
- `shared/vocabularioTranscricao.js` — vocabulário de domínio que corrige nomes próprios
- `TranscreverAudioParaAtividadeUseCase` e `TranscreverAudioParaCardUseCase`
- Gravação no front, já usada em outras abas

Ou seja: **voz no chat é montagem, não construção.**

### O que falta

1. **Botão de microfone no composer** de `js/features/assistente.js`, reaproveitando
   a gravação que já existe nas outras abas.
2. **Rota** `POST /api/agentes/conversar-audio` (multipart) → transcreve → entra no
   mesmo `TaskManager`. Nenhuma lógica de agente muda.
3. **Vocabulário é obrigatório aqui.** Sem ele, "Prosis" vira "Process", "Imdepa"
   vira "Impedia", "Redepro" vira "rede pro". O `ResolverEntidade` cobre parte, mas
   transcrição ruim de nome próprio é a maior fonte de erro em voz.

### Duas regras de segurança específicas de voz

1. **Mostre sempre o texto transcrito** como a mensagem do usuário, antes de agir.
   O usuário precisa poder ver que foi entendido errado. Áudio → ação direta, sem
   texto visível, é a receita para registrar a atividade errada.
2. **Voz nunca reduz o nível de confirmação.** Se o nível "Equilibrado" (seção 3)
   existir, entrada por voz continua confirmando visualmente — a chance de
   mal-entendido é estruturalmente maior.

### Resposta falada (TTS) — provavelmente não vale

Ler em voz alta um slide de 20 linhas não é útil; ninguém decora tabela ouvindo.
Se for fazer, limite a respostas curtas (consultas de tempo, confirmações) e deixe
o usuário escolher. Baixa prioridade.

### Esforço estimado
- Microfone + rota + transcrição: **1 dia**
- Ajuste de vocabulário e testes com áudio real: **0,5 dia**

---

## 5. Ordem sugerida

```
1. Memória da conversa (Camada 1)        ~2h    ← corrige falha atual, impacto imediato
2. Voz no chat                           ~1,5d  ← reaproveita o que existe
3. Memória de longo prazo, explícita     ~3-4d  ← inclui a tela de gestão
4. Desfazer + níveis de autoridade       ~2d    ← desfazer PRIMEIRO, nível depois
5. Novos tipos de ação                   ~1d cada
6. Extração automática de memória        ~2-3d  ← só depois que (3) estiver em uso
7. Ações proativas                       ~3d+
```

O item 1 é o de melhor retorno por esforço em todo o roadmap: duas horas de trabalho
transformam a percepção de "ferramenta de pergunta e resposta" em "assistente".

---

## 6. Riscos e decisões em aberto

| Risco | Mitigação |
|---|---|
| Memória errada envenena todas as conversas seguintes | Só memória explícita na v1; tela de gestão desde o início; confiança baixa para extraída |
| Modelo cita número "lembrado" como se fosse dado do banco | Negativa explícita no prompt (seção 2) + o teste de invariante já existente |
| Histórico infla custo por turno | Teto atual de 12 mensagens; sumarizar só quando virar problema real |
| Voz transcreve nome próprio errado e grava atividade errada | Vocabulário obrigatório + texto transcrito sempre visível antes de agir |
| Reduzir confirmação corrompe dados em silêncio | Desfazer é pré-requisito; `registrar_atividade` nunca automática |

**Decisões que dependem de você:**

1. Extração automática de memória vale o risco, ou memória explícita basta?
2. O nível "Ágil" deve existir, ou "Cauteloso" e "Equilibrado" bastam?
3. TTS interessa de verdade, ou voz só na entrada?
4. A tela de gestão de memórias vai em **Gerenciar** ou vira aba própria?

Nenhuma precisa ser respondida para começar o item 1.
