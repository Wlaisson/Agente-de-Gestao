// Fake da SDK 'openai' usada nos testes de caracterizacao de transcricao/
// relatorios/atividades/kanban: nenhuma chamada de rede real e feita. `new
// OpenAIMock().audio.transcriptions.create()`, `.chat.completions.create()`
// e `.embeddings.create()` sao configuraveis por teste via
// setTranscriptionHandler/setChatHandler/setEmbeddingHandler.
export function createOpenAIMock() {
  let transcriptionHandler = async () => ({ text: 'texto transcrito padrão' });
  let chatHandler = async () => ({ choices: [{ message: { content: '{}' } }] });
  // Vetor fake de 1536 dimensoes (bate com text-embedding-3-small) - suficiente
  // para os testes verificarem que um embedding foi anexado, sem precisar de
  // valores semanticamente reais.
  let embeddingHandler = async () => ({ data: [{ embedding: new Array(1536).fill(0) }] });

  class OpenAIMock {
    constructor(opts) {
      this.opts = opts;
      this.audio = {
        transcriptions: {
          create: (...args) => transcriptionHandler(...args)
        }
      };
      this.chat = {
        completions: {
          create: (...args) => chatHandler(...args)
        }
      };
      this.embeddings = {
        create: (...args) => embeddingHandler(...args)
      };
    }
  }

  async function toFile(buffer, filename, opts) {
    return { buffer, filename, opts };
  }

  return {
    OpenAIMock,
    toFile,
    setTranscriptionHandler: (fn) => { transcriptionHandler = fn; },
    setChatHandler: (fn) => { chatHandler = fn; },
    setEmbeddingHandler: (fn) => { embeddingHandler = fn; },
  };
}
