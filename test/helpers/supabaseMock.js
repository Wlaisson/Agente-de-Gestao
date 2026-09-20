// Lightweight stand-in for a @supabase/supabase-js client used in characterization
// tests. Real network calls to Supabase are never exercised in tests — every
// `.from(table)...` chain resolves through a per-test `fromHandler(table, calls)`
// function, and `.auth`/`.auth.admin` are swappable objects. This mimics the
// "thenable query builder" shape (`await supabase.from(x).select().eq().single()`)
// without needing the real SDK.
export function createSupabaseMock() {
  let fromHandler = () => ({ data: null, error: null });
  let authAdmin = {};
  let authClient = {};
  let rpcHandler = () => ({ data: [], error: null });

  function makeChain(table) {
    const calls = [];
    const chain = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve, reject) => {
            return Promise.resolve()
              .then(() => fromHandler(table, calls))
              .then(resolve, reject);
          };
        }
        if (prop === 'catch') {
          return (fn) => chain.then(undefined, fn);
        }
        return (...args) => {
          calls.push([prop, args]);
          return chain;
        };
      }
    });
    return chain;
  }

  const client = {
    from: (table) => makeChain(table),
    // .rpc() no supabase-js real tambem devolve um builder "thenable"
    // encadeavel, mas nenhum codigo deste projeto encadeia nada apos um
    // .rpc(...) (so faz `await supabaseAdmin.rpc(fn, params)` direto) -
    // uma Promise simples e suficiente e mais facil de configurar por teste.
    rpc: (fnName, params) => Promise.resolve().then(() => rpcHandler(fnName, params)),
    get auth() {
      return { admin: authAdmin, ...authClient };
    }
  };

  return {
    client,
    setFromHandler: (fn) => { fromHandler = fn; },
    setAuthAdmin: (obj) => { authAdmin = obj; },
    setAuthClient: (obj) => { authClient = obj; },
    setRpcHandler: (fn) => { rpcHandler = fn; },
  };
}

// Finds the argument of the first recorded call to `method` (e.g. ['eq', ['id', 'abc']]).
export function findCallArgs(calls, method) {
  const call = calls.find(([m]) => m === method);
  return call ? call[1] : undefined;
}

export function calledWith(calls, method) {
  return calls.some(([m]) => m === method);
}
