import { isOpcoesValido } from '../../../domain/entities/Opcoes.js';

// Portado verbatim de POST /api/opcoes em server.js: mantem o dispatcher de
// 10 acoes mutuamente exclusivas exatamente como estava (cada uma e um
// mini caso de uso "escondido" dentro da rota original) - so relocado para
// fora do handler Express. Uma quebra futura em use-cases individuais por
// acao pode acontecer depois, sem necessidade nesta fase.
export function makeAtualizarOpcoesUseCase({ opcoesRepository }) {
  return async function atualizarOpcoes(body) {
    const { action } = body;
    const opcoes = await opcoesRepository.carregar();

    if (action === 'salvar_tudo') {
      const { dados } = body;
      if (isOpcoesValido(dados)) {
        await opcoesRepository.salvar(dados);
        return dados;
      }
      const erro = new Error('Dados inválidos');
      erro.status = 400;
      throw erro;
    }

    if (action === 'adicionar_assunto') {
      const novo = (body.item || '').trim();
      if (novo && !opcoes.assuntosInternos.includes(novo)) {
        opcoes.assuntosInternos.push(novo);
        await opcoesRepository.salvar(opcoes);
      }
      return opcoes;
    }

    if (action === 'editar_assunto') {
      const antigo = (body.antigo || '').trim();
      const novo = (body.novo || '').trim();
      if (antigo && novo) {
        const idx = opcoes.assuntosInternos.indexOf(antigo);
        if (idx !== -1) {
          opcoes.assuntosInternos[idx] = novo;
          await opcoesRepository.salvar(opcoes);
        }
      }
      return opcoes;
    }

    if (action === 'excluir_assunto') {
      const item = (body.item || '').trim();
      opcoes.assuntosInternos = opcoes.assuntosInternos.filter(a => a !== item);
      await opcoesRepository.salvar(opcoes);
      return opcoes;
    }

    if (action === 'adicionar_projeto') {
      const novo = (body.item || '').trim();
      if (novo && !opcoes.projetos.includes(novo)) {
        opcoes.projetos.push(novo);
        await opcoesRepository.salvar(opcoes);
      }
      return opcoes;
    }

    if (action === 'editar_projeto') {
      const antigo = (body.antigo || '').trim();
      const novo = (body.novo || '').trim();
      if (antigo && novo) {
        const idx = opcoes.projetos.indexOf(antigo);
        if (idx !== -1) {
          opcoes.projetos[idx] = novo;
          await opcoesRepository.salvar(opcoes);
        }
      }
      return opcoes;
    }

    if (action === 'excluir_projeto') {
      const item = (body.item || '').trim();
      opcoes.projetos = opcoes.projetos.filter(p => p !== item);
      await opcoesRepository.salvar(opcoes);
      return opcoes;
    }

    if (action === 'adicionar_class1') {
      const c1 = (body.class1 || '').trim();
      if (c1 && !opcoes.classificacoes[c1]) {
        opcoes.classificacoes[c1] = [];
        await opcoesRepository.salvar(opcoes);
      }
      return opcoes;
    }

    if (action === 'editar_class1') {
      const antigo = (body.antigo || '').trim();
      const novo = (body.novo || '').trim();
      if (antigo && novo && antigo !== novo && opcoes.classificacoes[antigo]) {
        opcoes.classificacoes[novo] = opcoes.classificacoes[antigo];
        delete opcoes.classificacoes[antigo];
        await opcoesRepository.salvar(opcoes);
      }
      return opcoes;
    }

    if (action === 'excluir_class1') {
      const c1 = (body.class1 || '').trim();
      if (c1 && opcoes.classificacoes[c1]) {
        delete opcoes.classificacoes[c1];
        await opcoesRepository.salvar(opcoes);
      }
      return opcoes;
    }

    if (action === 'adicionar_class2') {
      const c1 = (body.class1 || '').trim();
      const c2 = (body.class2 || '').trim();
      if (c1 && c2 && opcoes.classificacoes[c1]) {
        if (!opcoes.classificacoes[c1].includes(c2)) {
          opcoes.classificacoes[c1].push(c2);
          await opcoesRepository.salvar(opcoes);
        }
      }
      return opcoes;
    }

    if (action === 'excluir_class2') {
      const c1 = (body.class1 || '').trim();
      const c2 = (body.class2 || '').trim();
      if (c1 && c2 && opcoes.classificacoes[c1]) {
        opcoes.classificacoes[c1] = opcoes.classificacoes[c1].filter(sub => sub !== c2);
        await opcoesRepository.salvar(opcoes);
      }
      return opcoes;
    }

    const erro = new Error('Ação de opções inválida');
    erro.status = 400;
    throw erro;
  };
}
