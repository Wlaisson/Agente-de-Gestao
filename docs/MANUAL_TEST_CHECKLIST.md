# Checklist manual de regressão

Sem suíte de testes de UI, esta checklist é a rede de segurança para validar
manualmente (num Vercel Preview Deployment) que uma fase da reorganização em
Clean Architecture não mudou o comportamento observável do app. Rode os itens
relevantes ao domínio tocado pela fase a cada fronteira; rode a checklist
inteira ao final da migração do backend (antes da Fase 10) e novamente ao
final de toda a reorganização.

## Autenticação e permissões
- [ ] Login com credenciais válidas abre o app na aba inicial correta para o perfil do usuário.
- [ ] Login com credenciais inválidas mostra erro sem travar a tela.
- [ ] Login com usuário autenticado no Supabase Auth mas sem linha em `usuarios` é rejeitado.
- [ ] Logout limpa a sessão e volta para a tela de login.
- [ ] Abas visíveis respeitam `permissoes.abas` do usuário logado (RBAC).

## Administração de usuários (`index.html` aba Gerenciar + `usuarios.html`)
- [ ] Listar usuários mostra nome, perfil, abas permitidas e data de cadastro.
- [ ] Criar usuário novo com permissões específicas funciona e aparece na lista.
- [ ] Excluir usuário remove da lista e do Supabase Auth.
- [ ] Acesso a `/usuarios` ou às ações de admin por um usuário não-admin é bloqueado.

## Setup pessoal (chave OpenAI + identidade visual do PDF)
- [ ] Salvar/alterar chave OpenAI e modelo preferido persiste corretamente.
- [ ] Campos de identidade visual do PDF (nome, empresa, logo, contato) salvam e refletem no relatório formal.

## Opções (assuntos, projetos, classificações)
- [ ] Adicionar/editar/excluir assunto interno reflete nos selects usados em outras abas.
- [ ] Adicionar/editar/excluir projeto reflete nos selects.
- [ ] Adicionar/editar/excluir classificação nível 1 e nível 2 (cascata) funciona.
- [ ] "Salvar tudo" persiste o conjunto completo sem perder dados não relacionados.

## Atividades
- [ ] Registrar atividade nova (manual) aparece na tabela da semana e no dashboard.
- [ ] Editar atividade existente atualiza os campos corretamente.
- [ ] Duplicar atividade cria uma cópia editável.
- [ ] Excluir atividade remove da lista.
- [ ] Filtro por semana e por intervalo de datas funciona.
- [ ] Transcrição de áudio (gravação → texto → preenchimento automático do formulário) funciona.

## Kanban
- [ ] Criar card novo (manual e por transcrição de áudio, incluindo múltiplas tarefas extraídas de um único áudio).
- [ ] Mover card entre colunas via drag & drop atualiza o status.
- [ ] Editar card existente salva as alterações.
- [ ] Concluir card (com registro de tempo/classificação) também gera uma atividade correspondente.
- [ ] Excluir card remove do board.

## Relatórios de IA
- [ ] "Resumo Executivo Semanal" (`/api/gerar-relatorio`) gera cards por assunto corretamente para uma semana com dados.
- [ ] Mesmo endpoint retorna estado vazio (não erro) para uma semana sem atividades.
- [ ] "Agente Repórter" (`/api/gerar-relatorio-reporter`) gera os quadrantes por assunto corretamente.
- [ ] Botões de copiar (card individual e "copiar tudo") funcionam.

## Relatório formal em PDF
- [ ] Selecionar período e projeto gera a folha formal com totais e dias úteis corretos.
- [ ] Identidade visual (logo/empresa) do setup aparece no PDF impresso.

## Reuniões (processar-reunião)
- [ ] Transcrição de reunião extrai corretamente `minhas_tarefas` e ignora texto de preenchimento/placeholder da IA.
- [ ] Tarefas extraídas aparecem na aba de tarefas/agenda (webhook legado do Google Apps Script).


## Assistente de Gestão (A2A)

### Interface, permissões e ciclo de vida do chat
- [ ] Aba **Assistente** visível apenas para usuários com permissão na aba (`permissoes.abas` com `assistente`), respeitando RBAC.
- [ ] Renderização correta de Markdown nas respostas do assistente: negrito (`**texto**`), listas com marcadores (`- item`), tabelas completas com cabeçalho/linhas (ex.: slide de IA) e separadores horizontais (`---`).
- [ ] Botão **Nova conversa** limpa as mensagens na tela e reseta o `contextId` da sessão (nova tarefa/contexto).

### Consultas de atividades e tempo (Analista)
- [ ] Pergunta geral de tempo ("quanto tempo eu gastei essa semana?") devolve a soma exata de horas e minutos calculada pelo `TempoCalculator`, batendo com o total da aba **Semana**.
- [ ] Resolução de entidade falada ("e na rede pro?") resolve deterministicamente para o projeto cadastrado (`Projetos - Rede Pró`).
- [ ] Tolerância a termos aproximados com ambiguidade ("e na redi pro?") oferece alternativas cadastradas sem inventar projeto inexistente.
- [ ] Consulta temporal abrangente ("o que eu fiz em setembro?") busca o período correto e lista as atividades consolidadas.

### Formatação de apresentações (Redator)
- [ ] "Gera o texto do weekly da [Cliente] dessa semana" gera cards por cliente com bullets no padrão estrito `**[Categoria]:** texto com números`.
- [ ] Seção "Próximas etapas" do Weekly é preenchida consultando tarefas reais do Kanban (`listar_tarefas`).
- [ ] "Monta o slide de agentes de catálogo da AI estratégica" gera tabela markdown formatada com colunas `Iniciativa | Responsável | Status | Prazo`, com status dentro do vocabulário fechado.
- [ ] Validação de fidelidade do texto: comparar texto gerado com o slide real aprovado e registrar divergências para ajuste de prompt/exemplos no arquivo `redatorPromptConfig.js`.

### Propostas e portão de escrita (Planejador e Registro)
- [ ] Proposta de criação de tarefa ("anota uma tarefa pra revisar o catálogo da Wurth até sexta") exibe o cartão interativo de proposta com botões e **não grava nada** no banco antes da decisão humana.
- [ ] Clicar no botão **Descartar** na proposta cancela a ação e confirma no banco/Supabase que nenhum card foi inserido.
- [ ] Clicar no botão **Confirmar e salvar** grava o card com `user_id` preenchido do usuário logado e dados exatos aprovados.
- [ ] Proposta de mover status da tarefa ("move a tarefa X para em andamento") exibe cartão com status anterior e novo; ao confirmar, atualiza o status revalidando dono do card.
- [ ] Ambiguidade na confirmação textual ("sim, mas muda o prazo pra segunda") é classificada como ambígua, descartando a proposta anterior e gerando nova proposta com prazo corrigido, sem nunca gravar a primeira.
- [ ] Proposta de registro de atividade ("registra aí: passei a manhã cadastrando SKU da Imdepa, umas 3 horas") gera proposta de atividade com alertas/avisos de campos faltantes quando necessário.

### Rastreabilidade e diagnóstico
- [ ] Em caso de comportamento inesperado ou erro, `GET /api/agentes/trace/<contextId>` retorna árvore de spans com agentes chamados, ferramentas executadas e tempos de resposta.

## Geral
- [ ] Console do navegador sem erros novos em nenhuma aba.
- [ ] `npm start` sobe localmente sem erro (ou o deploy de preview da Vercel builda sem erro).

