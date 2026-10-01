# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Profissionais da equipe interna da WMA que reportam o próprio trabalho: registram atividades, tarefas e reuniões e entregam relatórios de andamento. O uso é em desktop, no ambiente de trabalho.

O admin da conta é um segundo perfil: cria usuários, define quais abas cada um enxerga (permissões por aba) e mantém assuntos, projetos e classificações usados nos selects do app.

Não há cadastro aberto; as contas são criadas pelo admin.

## Product Purpose

WMA Report é um agente de gestão com IA que automatiza a rotina de reporte: transcrição de relatos por voz em registros estruturados, quadro Kanban, agenda de tarefas, resumo executivo semanal por assunto e relatório formal em PDF. Existe para tirar do profissional o trabalho manual de lembrar, redigir e consolidar o que fez.

Critério de sucesso ainda não definido pelo usuário.

## Positioning

Software feito para um público específico, a equipe da WMA, e que trabalha dentro do contexto de cada usuário: assuntos, projetos, classificações e histórico próprios alimentam a IA. Um Notion, Trello ou planilha genérico não conhece esse contexto.

## Operating Context

- Registro por voz: o áudio é transcrito e preenche o formulário de atividade, cria cards de Kanban (inclusive várias tarefas de um único áudio) ou extrai tarefas de reunião.
- Ciclo semanal: atividades registradas durante a semana alimentam o "Resumo Executivo Semanal" e o "Agente Repórter", que geram cards por assunto e quadrantes copiáveis.
- Relatório formal: PDF impresso por período e projeto, com totais, dias úteis e a identidade visual do usuário (nome, empresa, logo, contato).
- Cada usuário pode configurar a própria chave OpenAI e o modelo preferido na aba Setup.
- Abas atuais: Início, Registro, Kanban, Assistente, Agente Repórter, Semana, Resumo, Relatórios, Tarefas/Agenda, Gerenciar, Setup e, só para admin, Usuários.

## Capabilities and Constraints

- Stack existente: front-end em HTML, CSS e JavaScript sem framework (`index.html`, `styles.css`, `js/`), back-end Express organizado em Clean Architecture, Supabase (Auth, Postgres, pgvector para RAG) e OpenAI. Deploy na Vercel.
- Autorização por perfil com permissões por aba (RBAC); a interface deve esconder abas que o usuário não pode acessar.
- Tarefas de reunião e atividades ainda espelham para um webhook legado do Google Apps Script.
- Não há suíte de testes de UI; a validação de mudanças visuais é manual (`docs/MANUAL_TEST_CHECKLIST.md`).
- Em aberto: métrica de sucesso do produto e volume esperado de usuários.

## Brand Commitments

- Nome: WMA Report (título atual da página: "WMA Report | Automations & AI").
- Logo: `wma_logo.svg`, `wma_logo.png` e `wma_icon.svg` na raiz do repositório.
- Idioma: interface somente em português do Brasil.

Nome, logo e idioma foram confirmados como fixos. Nenhuma outra restrição de marca foi estabelecida.

## Evidence on Hand

Sem depoimentos, clientes nomeados, métricas ou casos de uso documentados. Trabalhos futuros não devem inventar nenhum. Os únicos ativos de marca são os arquivos de logo listados acima.

## Product Principles

1. Registrar deve custar menos do que lembrar depois: a entrada por voz e o preenchimento automático vêm antes de formulários longos.
2. A IA trabalha com o contexto do usuário; a interface deixa claro de onde vieram os dados que ela usou e deixa o usuário revisar antes de salvar ou enviar.
3. O relatório é o produto final: o que sai copiado ou impresso precisa estar pronto para chegar a um chefe ou cliente sem retrabalho.
4. Ferramenta de trabalho diário para uma equipe conhecida: velocidade e previsibilidade vencem novidade.
5. Cada perfil vê só o que precisa; permissões moldam a navegação, não aparecem como erros.

## Accessibility & Inclusion

Nenhum requisito específico definido.
