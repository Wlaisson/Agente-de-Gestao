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

  function makeChain(table) {
    const calls = [];
    const chain = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve, reject) => {
            Promise.resolve()
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
    get auth() {
      return { admin: authAdmin, ...authClient };
    }
  };

  return {
    client,
    setFromHandler: (fn) => { fromHandler = fn; },
    setAuthAdmin: (obj) => { authAdmin = obj; },
    setAuthClient: (obj) => { authClient = obj; },
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
