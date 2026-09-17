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

## Campanhas (somente localStorage, sem backend)
- [ ] Criar/editar/excluir campanha persiste entre reloads da página (mesmo navegador).
- [ ] Filtro de campanhas funciona.

## Geral
- [ ] Console do navegador sem erros novos em nenhuma aba.
- [ ] `npm start` sobe localmente sem erro (ou o deploy de preview da Vercel builda sem erro).
