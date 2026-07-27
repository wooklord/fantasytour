// Minimal stand-in for the supabase-js client, covering only the
// query-builder surface the app actually calls (.from/.select/.eq/.gte/.lt
// /.in/.order/.limit/.single, plus .rpc and .channel/.on/.subscribe).
export function createFakeSupabase(tables, rpcHandlers, calls){
  function builder(table){
    const filters = [];
    let orderSpec = null, limitN = null, wantSingle = false;
    const exec = () => {
      let rows = (tables[table] || []).filter(r => filters.every(f => f(r)));
      if (orderSpec) rows = rows.slice().sort((a,b) => {
        const av = a[orderSpec.col], bv = b[orderSpec.col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return orderSpec.asc ? cmp : -cmp;
      });
      if (limitN != null) rows = rows.slice(0, limitN);
      if (wantSingle) return { data: rows[0] ?? null, error: rows[0] ? null : { message: `no row in ${table}` } };
      return { data: rows, error: null };
    };
    const b = {
      select(){ return b; },
      eq(col,val){ filters.push(r => r[col] === val); return b; },
      gte(col,val){ filters.push(r => r[col] >= val); return b; },
      lt(col,val){ filters.push(r => r[col] < val); return b; },
      in(col,vals){ filters.push(r => vals.includes(r[col])); return b; },
      order(col,opts){ orderSpec = { col, asc: !(opts && opts.ascending === false) }; return b; },
      limit(n){ limitN = n; return b; },
      single(){ wantSingle = true; return b; },
      then(resolve,reject){
        calls?.push({ type:"query", table });
        return Promise.resolve(exec()).then(resolve, reject);
      },
      catch(reject){ return this.then(undefined, reject); },
    };
    return b;
  }
  // Minimal `col=eq.val` parser — the only filter shape the app ever sends —
  // so a fake emit only invokes handlers whose filter actually matches,
  // rather than trusting the real filter string compiles.
  function matchesFilter(filterStr, payload){
    if (!filterStr) return true;
    const m = /^(\w+)=eq\.(.+)$/.exec(filterStr);
    if (!m) return true;
    const [, col, val] = m;
    return String(payload[col]) === val;
  }
  const channelHandlers = [];
  return {
    from: builder,
    async rpc(fn, args){
      calls?.push({ type:"rpc", fn, args });
      const h = rpcHandlers[fn];
      if (!h) return { data: null, error: { message: `unhandled rpc ${fn}` } };
      try { return { data: await h(args, tables), error: null }; }
      catch(e){ return { data: null, error: { message: e.message } }; }
    },
    removeChannel(){}, // teardown-and-rebuild churns channels; nothing to clean up in the fake
    channel(name){
      const chan = {
        on(event, filter, cb){ channelHandlers.push({ event, filter, cb }); return chan; },
        subscribe(){ return chan; },
      };
      return chan;
    },
    // test-only hook to fire a fake postgres_changes event
    _emit(table, event, payload){
      for (const h of channelHandlers)
        if (h.filter.table === table && (h.filter.event === event || h.filter.event === "*")
            && matchesFilter(h.filter.filter, payload))
          h.cb({ new: payload });
    },
  };
}
