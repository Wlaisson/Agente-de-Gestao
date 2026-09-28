// Script unico para preencher retroativamente o embedding de atividades
// gravadas antes da coluna `embedding` existir em producao (ou antes do
// fallback de SupabaseAtividadeRepository entrar no ar) - essas linhas
// ficam com embedding = null e por isso nunca aparecem como "atividade
// similar" para o RAG (match_atividades filtra `embedding is not null`),
// mesmo continuando 100% funcionais no resto do app.
//
// Uso:
//   node scripts/backfill_embeddings_atividades.js                 -> todas as linhas com embedding null
//   node scripts/backfill_embeddings_atividades.js --semana "TEXTO_DA_SEMANA"  -> so as dessa semana
//   node scripts/backfill_embeddings_atividades.js --dry-run        -> so mostra quantas/quais linhas seriam afetadas, nao grava nada
import { supabaseAdmin } from '../supabaseClient.js';
import { createOpenAIGateway } from '../interface-adapters/gateways/OpenAIGateway.js';
import { createEmbeddingsGateway } from '../interface-adapters/gateways/EmbeddingsGateway.js';
import { openaiGlobal, MODELOS, MODELO_EMBEDDING } from '../infrastructure/openai/openaiClient.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const semanaIdx = args.indexOf('--semana');
const semanaFiltro = semanaIdx !== -1 ? args[semanaIdx + 1] : null;

const openAIGateway = createOpenAIGateway({ supabaseAdmin, openaiGlobal, modelosPadrao: MODELOS });
const embeddingsGateway = createEmbeddingsGateway({ modeloEmbedding: MODELO_EMBEDDING });

async function main() {
  let query = supabaseAdmin
    .from('atividades')
    .select('id, user_id, titulo, atividade, semana')
    .is('embedding', null);

  if (semanaFiltro) {
    query = query.eq('semana', semanaFiltro);
  }

  const { data: linhas, error } = await query;
  if (error) {
    console.error('Erro ao buscar atividades sem embedding:', error.message);
    process.exit(1);
  }

  if (!linhas || linhas.length === 0) {
    console.log('Nenhuma atividade sem embedding encontrada' + (semanaFiltro ? ` para a semana "${semanaFiltro}"` : '') + '.');
    return;
  }

  console.log(`${linhas.length} atividade(s) sem embedding encontrada(s)${semanaFiltro ? ` na semana "${semanaFiltro}"` : ''}.`);
  if (dryRun) {
    linhas.forEach(l => console.log(`  - ${l.id} | ${l.titulo || '(sem titulo)'}`));
    console.log('Dry-run: nada foi gravado.');
    return;
  }

  let sucesso = 0;
  let falhas = 0;

  for (const linha of linhas) {
    const texto = `${linha.titulo || ''}\n${linha.atividade || ''}`.trim();
    if (!texto) {
      console.log(`  - ${linha.id}: sem titulo/atividade, pulando.`);
      continue;
    }

    try {
      const { openai } = await openAIGateway.obterCliente(linha.user_id);
      const embedding = await embeddingsGateway.gerarEmbedding({ openai, texto });
      if (!embedding) {
        console.log(`  - ${linha.id}: geracao retornou vazio, pulando.`);
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from('atividades')
        .update({ embedding })
        .eq('id', linha.id);

      if (updateError) {
        console.log(`  - ${linha.id}: erro ao gravar - ${updateError.message}`);
        falhas += 1;
      } else {
        console.log(`  - ${linha.id}: embedding gravado.`);
        sucesso += 1;
      }
    } catch (e) {
      console.log(`  - ${linha.id}: erro - ${e.message}`);
      falhas += 1;
    }
  }

  console.log(`\nConcluido: ${sucesso} gravado(s), ${falhas} falha(s), de ${linhas.length} total.`);
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
