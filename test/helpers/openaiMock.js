// Fake da SDK 'openai' usada nos testes de caracterizacao de transcricao/
// relatorios: nenhuma chamada de rede real e feita. `new OpenAIMock().audio
// .transcriptions.create()` e `.chat.completions.create()` sao configuraveis
// por teste via setTranscriptionHandler/setChatHandler.
export function createOpenAIMock() {
  let transcriptionHandler = async () => ({ text: 'texto transcrito padrão' });
  let chatHandler = async () => ({ choices: [{ message: { content: '{}' } }] });

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
  };
}
