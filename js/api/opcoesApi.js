// Um fetch por acao do dispatcher POST /api/opcoes, substituindo os ~13
// blocos fetch/try-catch identicos que existiam espalhados em index.html.
// Cada funcao retorna o JSON ja parseado (mesma forma { status, data|error }
// que o backend sempre devolveu) - quem chama continua tratando status/erro
// como antes, so o "como chamar a API" foi centralizado aqui.
async function postOpcoes(body) {
  const res = await fetch('/api/opcoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function obterOpcoes() {
  const res = await fetch('/api/opcoes');
  return res.json();
}

export function salvarTudo(dados) {
  return postOpcoes({ action: 'salvar_tudo', dados });
}

export function adicionarAssunto(item) {
  return postOpcoes({ action: 'adicionar_assunto', item });
}

export function editarAssunto(antigo, novo) {
  return postOpcoes({ action: 'editar_assunto', antigo, novo });
}

export function excluirAssunto(item) {
  return postOpcoes({ action: 'excluir_assunto', item });
}

export function adicionarProjeto(item) {
  return postOpcoes({ action: 'adicionar_projeto', item });
}

export function editarProjeto(antigo, novo) {
  return postOpcoes({ action: 'editar_projeto', antigo, novo });
}

export function excluirProjeto(item) {
  return postOpcoes({ action: 'excluir_projeto', item });
}

export function adicionarClass1(class1) {
  return postOpcoes({ action: 'adicionar_class1', class1 });
}

export function editarClass1(antigo, novo) {
  return postOpcoes({ action: 'editar_class1', antigo, novo });
}

export function excluirClass1(class1) {
  return postOpcoes({ action: 'excluir_class1', class1 });
}

export function adicionarClass2(class1, class2) {
  return postOpcoes({ action: 'adicionar_class2', class1, class2 });
}

export function excluirClass2(class1, class2) {
  return postOpcoes({ action: 'excluir_class2', class1, class2 });
}
