# Handoff — Sistema Multiagente A2A

Documento de continuidade. Escrito para ser lido **sem** a conversa que originou o
código: descreve o que existe, por que existe, o que falta e o que não deve ser
revertido por engano.

Última atualização: 30/09/2026 · Suíte: **141 testes, 141 passando**.

---

## 1. O que o sistema faz

Um assistente conversacional de gestão, na aba **Assistente** do WMA Report.
O usuário pergunta em português sobre as próprias atividades e recebe:

- Consultas com números reais ("quanto tempo gastei essa semana na RedePRO?").
- **Texto pronto para colar** nas duas apresentações de status que ele mantém:
  - **Weekly Conteúdo Técnico** — card por cliente, bullets no padrão `[Categoria]: texto com números`.
  - **AI Estratégica** — slide *Agentes de Catálogo*: tabela Iniciativa | Responsável | Status | Prazo.
- Consulta ao Kanban (pendências, atrasos) e **propostas** de criar/mover tarefa
  ou registrar atividade — sempre com confirmação humana antes de gravar.

O motivo de existir: hoje o usuário copia dados do sistema, cola no Gemini, pede um
resumo e cola no slide. O assistente elimina esse trajeto.

---

## 2. Arquitetura, em uma página

Multiagente com protocolo **A2A** (Agent-to-Agent): agent cards, ciclo de vida de
tarefa (`submitted → working → input-required → completed`), JSON-RPC 2.0.

```
Usuário → UI (aba Assistente)
            ↓ POST /api/agentes/conversar
        TaskManager  ← portão de escrita (confirmação)
            ↓
        ORQUESTRADOR ("Cérebro de Gestão")
            ↓ delega via A2A (sub-tarefas no mesmo contextId)
   ┌────────┼────────┬──────────┐
 analista  redator  planejador  registro
   ↓         ↓         ↓          ↓
        Ferramentas → use-cases EXISTENTES do app → Supabase
```

**Os agentes não têm caminho próprio até o banco.** Cada ferramenta chama o mesmo
use-case que as telas já usam (`listarAtividades`, `adicionarCard`, `criarAtividade`…).
Corrigir um bug de domínio conserta os dois caminhos de uma vez.

### Duas fronteiras, um núcleo

| Rota | Formato | Consumidor |
|---|---|---|
| `/api/agentes/*` | REST simples | a UI deste produto |
| `/a2a` | JSON-RPC 2.0 A2A | clientes de agente externos (ex.: Core agêntico da CWS) |
| `/.well-known/agent-card.json` | Agent Card | descoberta A2A |
| `/.well-known/agent-cards.json` | lista de cards | depuração / roteamento externo |

As duas entram no **mesmo** `TaskManager`. Nenhuma regra de segurança é duplicada.

### Local vs. remoto

O registry abstrai o transporte. Promover um especialista a serviço independente
**não muda código** — basta a env var:

```bash
AGENTES_REMOTOS=redator@https://redator.exemplo.com,catalogo@https://core.cws/agents
```

Sem ela (padrão), todos rodam no mesmo processo.

---

## 3. Três invariantes que NÃO devem ser revertidas

São o que separa este sistema de um chatbot que corrompe dados. Cada uma tem teste.

### 3.1 Número sai de código, nunca do LLM
O modelo decide **o que** consultar; `domain/services/TempoCalculator.js` soma.
Nenhum total da resposta passa pela aritmética do modelo.
→ `test/a2a-dominio.test.js` · "Tempo: soma total e quebra por dimensão"

### 3.2 Identidade é injetada, nunca inferida
`definirFerramenta()` **lança erro** se uma ferramenta declarar `userId` no schema
exposto ao modelo. O `userId` vem do token autenticado, via `contexto`. Se fosse
parâmetro, uma injeção de prompt vazaria dados entre contas.
→ `test/a2a-dominio.test.js` · "Ferramenta: declarar userId como parametro e proibido"

### 3.3 Escrita é proposta, não ação
Ferramentas `escrita: true` **não gravam**. Devolvem uma proposta → tarefa vai para
`input-required` → o usuário confirma → um executor determinístico grava **os dados
exatos que foram mostrados na tela**, não uma nova saída do modelo.

A interpretação da confirmação (`domain/services/InterpretarConfirmacao.js`) é
deliberadamente burra e **não usa LLM**: pedir ao modelo que classifique "isso foi um
sim?" colocaria a decisão de gravar no componente manipulável por injeção.

Caso importante coberto: **"sim, mas troca o projeto"** → `AMBIGUO`, descarta a
proposta antiga e reprocessa. Tratar como "sim" gravaria a proposta errada.
→ `test/agentes-runtime.test.js` · bloco "Escrita"

---

## 4. Mapa de arquivos

### Domínio (puro, sem I/O)
| Arquivo | Papel |
|---|---|
| `domain/a2a/Task.js` | Ciclo de vida + máquina de estados |
| `domain/a2a/Message.js` | Mensagens A2A com `parts` tipadas (texto + dados) |
| `domain/a2a/AgentCard.js` | Card de auto-descrição do agente |
| `domain/a2a/erros.js` | Códigos JSON-RPC e A2A da spec |
| `domain/services/TempoCalculator.js` | Aritmética de tempo (backend) |
| `domain/services/ResolverEntidade.js` | "rede pro" → "Projetos - Rede Pró"; detecta ambiguidade |
| `domain/services/ResolverPeriodo.js` | "semana passada" → intervalo de datas determinístico |
| `domain/services/InterpretarConfirmacao.js` | **Portão de escrita** |

### Runtime dos agentes
| Arquivo | Papel |
|---|---|
| `application/agents/runtime/AgentRuntime.js` | Laço modelo → ferramentas → modelo, com teto de iterações |
| `application/agents/runtime/ToolExecutor.js` | Executa ferramenta, injeta contexto, audita, converte erro em resultado |
| `application/agents/runtime/TaskManager.js` | Ciclo de vida + confirmação de escrita |
| `application/agents/runtime/definirFerramenta.js` | Contrato de ferramenta + invariante do `userId` |
| `application/agents/runtime/criarAgenteLlm.js` | Fábrica comum dos agentes |
| `application/agents/registry/AgentRegistry.js` | Descoberta; local vs. remoto |
| `application/agents/composicao.js` | **Composition root** do sistema de agentes |

### Agentes
| Agente | Arquivo | Escreve? |
|---|---|---|
| Orquestrador | `orchestrator/OrchestratorAgent.js` + `criarDelegacao.js` | via delegação |
| Analista | `analista/AnalistaAgent.js` | não |
| **Redator** | `redator/RedatorAgent.js` + **`redatorPromptConfig.js`** | não |
| Planejador | `planejador/PlanejadorAgent.js` | sim (proposta) |
| Registro | `registro/RegistroAgent.js` | sim (proposta) |

> **`redator/redatorPromptConfig.js` é o arquivo mais importante do produto.**
> É onde os dois formatos de apresentação viram especificação executável, com
> exemplos derivados dos slides reais. É o arquivo que mais vai ser ajustado.

### Infra e fronteiras
`interface-adapters/a2a/A2AJsonRpcServer.js` · `HttpA2AClient.js` ·
`controllers/agentesController.js` · `routes/agentesRoutes.js` ·
`repositories/SupabaseTarefaA2ARepository.js` · `SupabaseAuditoriaRepository.js` ·
`infrastructure/tracing/Tracer.js`

### Frontend
`js/features/assistente.js` (chat + cartão de proposta) · `js/api/agentesApi.js` ·
aba `assistente-tab` em `index.html` · estilos no fim de `styles.css`

---

## 5. Passos restantes

### PASSO 1 — Aplicar a migração SQL `[BLOQUEANTE PARA PRODUÇÃO]`

O sistema **funciona sem isso**, mas as tarefas ficam só em memória do processo.
Na Vercel, com mais de uma instância, **a confirmação pode chegar numa instância que
nunca viu a proposta** — e o fluxo de escrita quebra de forma intermitente.

1. Abrir o **SQL Editor** do Supabase.
2. Colar e rodar o conteúdo de **`schema-a2a.sql`** (na raiz). É idempotente.
3. Confere que criou: `a2a_tarefas`, `a2a_auditoria`, e o índice `idx_kanban_cards_user`.

Como saber se ainda não foi aplicado: o log mostra
`[a2a] Tabela "a2a_tarefas" indisponível (...)`.

---

### PASSO 2 — Backfill do dono dos cards do Kanban

**Contexto:** até esta implementação, `kanban_cards.user_id` **nunca era preenchido** e
`listarCards()` devolvia os cards de todos os usuários. Isso foi corrigido para
escritas novas. As linhas antigas continuam com `user_id` nulo e aparecem para todo
mundo, marcadas com `semDono: true` (o agente avisa que a tarefa é anterior ao
controle por usuário, em vez de atribuí-la a quem perguntou).

```bash
# 1. Ver o que está sem dono, agrupado por projeto
node scripts/backfill_user_id_kanban.js --listar

# 2. Simular a atribuição
node scripts/backfill_user_id_kanban.js --user <uuid-do-usuario> --dry-run

# 3. Aplicar (opcionalmente por projeto)
node scripts/backfill_user_id_kanban.js --user <uuid> --projeto "Projetos - Wurth"
```

Depois que não sobrar nenhum `user_id` nulo, considere trocar o padrão de
`incluirSemDono` para `false` em `application/agents/tools/kanbanTools.js`
(função `cardsDoUsuario`).

---

### PASSO 3 — Variáveis de ambiente

Ver `docs/ENV_VARS.md` para a tabela completa. As que importam agora:

| Variável | Ação |
|---|---|
| `PERMITIR_CHAVE_OPENAI_COMPARTILHADA` | **Deixe desligada.** Ligada, restaura o fallback antigo que usa a chave OpenAI de outro usuário — custo cobrado de terceiro. Com o chat, isso vira recorrente. |
| `TRACE_AGENTES=true` | Ligue em dev. Imprime cada span (delegação, ferramenta, chamada de modelo) com a duração. |
| `AGENTES_REMOTOS` | Só ao distribuir (Passo 8). |
| `A2A_TOKEN_SERVICO` | Obrigatória se usar `AGENTES_REMOTOS`. |

---

### PASSO 4 — Teste manual com dados reais `[MAIOR RISCO DO PROJETO]`

Os testes automatizados provam que o **encanamento** está correto (nada grava sem
confirmação, o escopo por usuário se sustenta, os cálculos batem). Eles **não provam
que o texto gerado presta** — nenhum teste chamou a OpenAI de verdade.

Rode local (`npm start`), abra a aba **Assistente** e execute:

**Consultas (agente Analista)**
1. "quanto tempo eu gastei essa semana?"
2. "e na rede pro?" — valida a resolução de nome falado → `Projetos - Rede Pró`
3. "e na redi pro?" — deve **oferecer alternativas**, não inventar
4. "o que eu fiz em setembro?"
5. Confira os totais contra a aba **Semana**. Se divergirem, o bug está em
   `TempoCalculator.js` ou no filtro de período — não no prompt.

**Apresentações (agente Redator) — o ponto central**
6. "gera o texto do weekly da Imdepa dessa semana"
7. "monta o slide de agentes de catálogo da AI estratégica"
8. Cole o resultado no slide real e compare com o que você escreveria à mão.
9. **Anote cada divergência** — é o insumo do Passo 5.

**Escrita (Planejador / Registro)**
10. "anota uma tarefa pra revisar o catálogo da Wurth até sexta"
    → deve aparecer **cartão de proposta com botões**, nada gravado ainda
11. Clique **Descartar** → confirme no Supabase que nada foi criado
12. Repita e clique **Confirmar e salvar** → confirme que o card nasceu com `user_id`
13. Peça outra tarefa e responda **"sim, mas muda o prazo pra segunda"**
    → deve **repropor com o prazo novo**, nunca gravar a proposta antiga
14. "registra aí: passei a manhã cadastrando SKU da Imdepa, umas 3 horas"
    → ficha com avisos dos campos faltantes

**Diagnóstico:** se algo sair estranho, pegue o `contextId` e abra
`GET /api/agentes/trace/<contextId>` — mostra quais agentes e ferramentas rodaram.

---

### PASSO 5 — Ajuste dos formatos de apresentação

Espere **3 a 5 rodadas** de ajuste. É trabalho de prompt, não de código.

Arquivo: **`application/agents/redator/redatorPromptConfig.js`**

| Sintoma | Onde mexer |
|---|---|
| Formato do bullet errado | `ESPECIFICACAO_FORMATOS`, bloco do formato |
| Inventa SLA / Validações QA | `REDATOR_NEGATIVAS` — reforce a negativa |
| Consolida demais ou de menos | `REDATOR_PERSONA`, seção "Consolidação" |
| Tom errado (pessoal demais) | `REDATOR_NEGATIVAS` (já proíbe 1ª pessoa) |
| Status fora do padrão | `STATUS_AI_ESTRATEGICA` / `STATUS_WEEKLY` |
| Saída quase certa, erra num caso | **Adicione um exemplo** em `REDATOR_EXEMPLOS` |

**A alavanca mais forte são os exemplos few-shot.** Cada entrada tem
`{ tipo, entrada, ferramentas, saida }`. Colar uma saída real aprovada por você
vale mais que qualquer instrução em prosa.

**Limite conhecido e intencional:** SLA, Validações QA, fases do histórico e pontos
de atenção **não existem** nos registros de atividade. O agente marca como
"a confirmar" em vez de inventar. Se quiser que saiam automaticamente, é preciso
passar a registrar esses campos — decisão de produto, não de prompt.

---

### PASSO 6 — Checklist de teste manual

Adicione os casos do Passo 4 a `docs/MANUAL_TEST_CHECKLIST.md`, seguindo o formato
que já existe lá. O projeto não tem teste de UI automatizado; esse arquivo é a rede
de segurança visual.

Inclua também:
- A aba **Assistente** respeita RBAC (ela já foi adicionada às listas de permissão
  em `index.html` e `usuarios.html`, e a `TAB_TITULOS` em `js/ui/sidebar.js`).
- O botão "Nova conversa" limpa o histórico e reinicia o `contextId`.
- Markdown renderiza: negrito, listas, tabela (do slide de IA) e o separador `---`.

---

### PASSO 7 — Evals (recomendado antes de escalar o uso)

Sem isso, cada ajuste de prompt pode consertar um caso e quebrar outro em silêncio.

Montagem sugerida, reaproveitando o que já existe:

1. Crie `test/evals/casos-redator.json` com 10–15 casos:
   `{ pergunta, atividadesDeEntrada, saidaEsperada, criterios: [...] }`.
   Use seus relatórios antigos como gabarito.
2. Escreva `scripts/eval_redator.js` que roda cada caso contra o agente real e
   avalia com **checagens determinísticas primeiro** (as baratas e confiáveis):
   - o texto contém os números que estavam nas atividades de entrada?
   - **não** contém número que não estava? (detector de alucinação)
   - o status usado está no vocabulário fechado?
   - o bullet segue `**[Categoria]:** texto`?
3. Só depois, se necessário, um LLM-as-judge para tom e consolidação.
4. Rode antes e depois de cada mudança de prompt, comparando a taxa.

O padrão de dublês para não chamar a OpenAI de verdade está em
`test/helpers/openaiMock.js`. Para eval você quer o oposto — chamada real — então
rode como script, não como teste da suíte.

---

### PASSO 8 — Distribuir de fato (opcional)

Hoje tudo roda em um processo, mas o protocolo já é A2A de verdade. Para separar:

1. Crie um deploy que exponha `/a2a` e `/.well-known/agent-card.json`
   (reaproveite `createA2AJsonRpcServer` + `createAgentesRoutes`).
2. No serviço principal:
   ```bash
   AGENTES_REMOTOS=redator@https://redator.seu-dominio.com
   A2A_TOKEN_SERVICO=<segredo-forte-compartilhado>
   ```
3. O `composicao.js` deixa de registrar o redator local e passa a usar o
   `HttpA2AClient`. **Nenhum outro arquivo muda.**

**Opinião honesta, registrada para não se perder:** enquanto não existir um segundo
sistema de agentes do outro lado (o Core agêntico da CWS, os agentes de Catálogo),
distribuir só adiciona custo operacional — deploys separados, falhas de rede, debug
distribuído. O protocolo estar pronto é o que importa; o deploy separado pode esperar
o parceiro do outro lado existir.

---

## 6. Lacunas conhecidas (dívida honesta)

Nenhuma bloqueia o uso. Estão listadas para não serem descobertas por acidente.

| # | Lacuna | Onde | Gravidade |
|---|---|---|---|
| 1 | `atualizarStatusCard` **não revalida o dono** na escrita. Hoje é seguro porque o id só chega via `listar_tarefas` (já escopada), mas falta defesa em profundidade. | `application/use-cases/kanban/AtualizarStatusCardUseCase.js` | média |
| 2 | O `redator` recebe `kanbanTools[0]` — dependência **posicional** do array. Trocar a ordem em `criarKanbanTools` quebraria em silêncio. Melhor: buscar por nome. | `application/agents/composicao.js` | baixa |
| 3 | Fallback do Kanban em `kanban_data.json` (arquivo local) não tem coluna de dono; o filtro é feito em memória. Em serverless o arquivo é efêmero. | `SupabaseKanbanRepository.js` | baixa |
| 4 | `message/stream` (SSE) e push notifications do A2A **não implementados**. Os cards declaram `streaming: false`, então um cliente conforme não chama. Resposta longa (slide) demora sem feedback incremental. | `A2AJsonRpcServer.js` | baixa |
| 5 | Histórico de conversas **não aparece na UI**. O repositório já tem `listarPorContexto`, mas nada consome. Recarregar a página perde o fio. | `js/features/assistente.js` | baixa |
| 6 | Sem entrada por **voz** no chat, embora o app já transcreva áudio em outras abas. Reaproveitar `TranscreverAudioParaAtividadeUseCase` seria direto. | — | baixa |
| 7 | `listarAtividades` com `todos=true` ignora o escopo por usuário sem checar admin (lacuna **pré-existente**, não introduzida aqui). O agente nunca passa `todos`. | `ListarAtividadesUseCase.js` | média |

---

## 7. Dois bugs reais corrigidos no caminho

Registrados porque não são óbvios e podem reaparecer.

**1. `OpenAIGateway` rejeitava toda chamada de ferramenta como "resposta vazia".**
O guard tratava `content: null` como falha. Em tool calling, `content: null` com
`tool_calls` preenchido é a resposta **correta**. Sem a ressalva, o sistema de agentes
nunca executava nada. Os testes de runtime não pegaram porque mockam o gateway — só o
teste de ponta a ponta revelou.
→ `interface-adapters/gateways/OpenAIGateway.js`, guard de resposta vazia

**2. `"para"` estava na lista de negações da confirmação.**
É preposição comum em português: `"pode criar para o projeto X"` era lido como recusa.
Ficou só `pare`/`parar`.
→ `domain/services/InterpretarConfirmacao.js`

---

## 8. Comandos úteis

```bash
npm test                                    # suíte completa (141 testes)
node --test test/a2a-dominio.test.js        # só domínio (rápido, sem mocks)
node --experimental-test-module-mocks --test --test-concurrency=1 test/agentes-api.test.js

npm start                                   # sobe local na porta 5555
TRACE_AGENTES=true npm start                # com trace de agentes no console

curl localhost:5555/.well-known/agent-card.json      # card do orquestrador
curl localhost:5555/api/agentes                      # todos os cards
curl localhost:5555/api/agentes/trace/<contextId>    # árvore de execução
```

---

## 9. Ordem sugerida

```
PASSO 1 (SQL)  →  PASSO 3 (env)  →  PASSO 4 (teste real)  →  PASSO 5 (ajuste de prompt)
                                            ↑______________________|
                                              repetir 3–5 vezes

depois:  PASSO 2 (backfill)  →  PASSO 6 (checklist)  →  PASSO 7 (evals)
opcional: PASSO 8 (distribuir)
```

O ciclo 4 ↔ 5 é onde está o valor. O resto é higiene.
