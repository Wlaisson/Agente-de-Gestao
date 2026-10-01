// Preenche retroativamente `kanban_cards.user_id`.
//
// Contexto: ate a introducao do sistema de agentes, nenhuma escrita do
// Kanban gravava o dono do card (lacuna ja registrada em
// schema-embeddings.sql), e a listagem devolvia os cards de TODOS os
// usuarios. As escritas novas passaram a gravar o dono; as linhas antigas
// continuam com user_id nulo.
//
// Enquanto forem nulas, elas aparecem para todo mundo, marcadas com
// `semDono: true` - o agente avisa que a tarefa e anterior ao controle por
// usuario em vez de atribui-la a quem perguntou. Este script fecha esse
// buraco.
//
// Nao existe forma automatica e confiavel de descobrir o dono de um card
// antigo: o dado nunca foi gravado. Por isso o script exige que o usuario
// alvo seja informado, e oferece filtros para atribuir por partes.
//
// Uso:
//   node scripts/backfill_user_id_kanban.js --listar
//       -> mostra quantos cards estao sem dono, agrupados por projeto
//   node scripts/backfill_user_id_kanban.js --user <uuid> --dry-run
//       -> mostra o que seria alterado, sem gravar
//   node scripts/backfill_user_id_kanban.js --user <uuid> --projeto "Projetos - Wurth"
//       -> atribui so os cards daquele projeto
//   node scripts/backfill_user_id_kanban.js --user <uuid>
//       -> atribui TODOS os cards sem dono (use com cuidado se houver mais de um usuario)
import { supabaseAdmin } from '../supabaseClient.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apenasListar = args.includes('--listar');

function valorDe(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const userId = valorDe('--user');
const projetoFiltro = valorDe('--projeto');

async function buscarSemDono() {
  let query = supabaseAdmin
    .from('kanban_cards')
    .select('id, titulo, projeto, status, data_criacao')
    .is('user_id', null);

  if (projetoFiltro) query = query.eq('projeto', projetoFiltro);

  const { data, error } = await query;
  if (error) {
    console.error('Erro ao buscar cards sem dono:', error.message);
    process.exit(1);
  }
  return data || [];
}

async function main() {
  const cards = await buscarSemDono();

  if (cards.length === 0) {
    console.log('Nenhum card sem dono. Nada a fazer.');
    return;
  }

  if (apenasListar) {
    const porProjeto = new Map();
    for (const c of cards) {
      const chave = c.projeto || '(sem projeto)';
      porProjeto.set(chave, (porProjeto.get(chave) || 0) + 1);
    }
    console.log(`${cards.length} card(s) sem dono:\n`);
    for (const [projeto, total] of [...porProjeto.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(total).padStart(4)}  ${projeto}`);
    }
    console.log('\nPara atribuir: node scripts/backfill_user_id_kanban.js --user <uuid> [--projeto "NOME"] [--dry-run]');
    return;
  }

  if (!userId) {
    console.error('Informe o usuário dono com --user <uuid>. Use --listar para inspecionar antes.');
    process.exit(1);
  }

  // Valida o uuid antes de escrever: um id inexistente violaria a FK e
  // abortaria no meio, deixando parte dos cards atribuidos.
  const { data: usuario, error: erroUsuario } = await supabaseAdmin
    .from('setup_usuario')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (erroUsuario) {
    console.warn('Aviso: não consegui validar o usuário em setup_usuario:', erroUsuario.message);
  } else if (!usuario) {
    console.warn(`Aviso: ${userId} não tem linha em setup_usuario. Confirme que o uuid está correto.`);
  }

  console.log(`${cards.length} card(s) sem dono${projetoFiltro ? ` no projeto "${projetoFiltro}"` : ''}.`);
  if (dryRun) {
    console.log('\n--dry-run: nada será gravado. Cards que seriam atribuídos:\n');
    for (const c of cards) {
      console.log(`  ${c.id}  [${c.status}]  ${c.titulo} (${c.projeto || 'sem projeto'})`);
    }
    return;
  }

  let ok = 0;
  let falhas = 0;
  for (const card of cards) {
    const { error } = await supabaseAdmin
      .from('kanban_cards')
      .update({ user_id: userId })
      .eq('id', card.id)
      // Reafirma a condicao na escrita: se outro processo atribuir um dono
      // no meio da execucao, nao sobrescrevemos.
      .is('user_id', null);

    if (error) {
      falhas++;
      console.error(`  falhou ${card.id}: ${error.message}`);
    } else {
      ok++;
    }
  }

  console.log(`\nConcluído: ${ok} atribuído(s), ${falhas} falha(s).`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
