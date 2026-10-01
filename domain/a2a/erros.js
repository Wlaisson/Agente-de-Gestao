// Codigos de erro JSON-RPC 2.0 + os codigos especificos do A2A.
//
// A faixa -32700..-32600 e do JSON-RPC (parse/formato). A faixa -32001..
// -32006 e do A2A e descreve falhas de dominio do protocolo. Manter os
// numeros da spec (em vez de inventar) e o que permite um cliente A2A
// generico - inclusive de outro time - tratar nossos erros sem codigo
// especifico para este servidor.

export const CODIGOS_JSONRPC = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
});

export const CODIGOS_A2A = Object.freeze({
  TAREFA_NAO_ENCONTRADA: -32001,
  TAREFA_NAO_CANCELAVEL: -32002,
  PUSH_NAO_SUPORTADO: -32003,
  OPERACAO_NAO_SUPORTADA: -32004,
  TIPO_CONTEUDO_INCOMPATIVEL: -32005,
  AGENTE_NAO_ENCONTRADO: -32006
});

export class ErroA2A extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = 'ErroA2A';
    this.code = code;
    this.data = data;
  }

  paraJsonRpc() {
    const erro = { code: this.code, message: this.message };
    if (this.data !== null) erro.data = this.data;
    return erro;
  }
}

export const erroTarefaNaoEncontrada = (taskId) =>
  new ErroA2A(CODIGOS_A2A.TAREFA_NAO_ENCONTRADA, `Tarefa nao encontrada: ${taskId}`);

export const erroAgenteNaoEncontrado = (agentId) =>
  new ErroA2A(CODIGOS_A2A.AGENTE_NAO_ENCONTRADO, `Agente nao encontrado: ${agentId}`);

export const erroTarefaNaoCancelavel = (taskId, estado) =>
  new ErroA2A(
    CODIGOS_A2A.TAREFA_NAO_CANCELAVEL,
    `Tarefa ${taskId} esta em estado terminal "${estado}" e nao pode ser cancelada.`
  );

export const erroMetodoNaoEncontrado = (metodo) =>
  new ErroA2A(CODIGOS_JSONRPC.METHOD_NOT_FOUND, `Metodo nao suportado: ${metodo}`);

export const erroParametrosInvalidos = (mensagem) =>
  new ErroA2A(CODIGOS_JSONRPC.INVALID_PARAMS, mensagem);
