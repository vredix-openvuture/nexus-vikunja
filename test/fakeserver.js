'use strict';
/* Vikunja as far as the plugin talks to it: projects, a kanban view with
   buckets, tasks; paging; POST /tasks replacing the whole task. */
function fakeVikunja(opts) {
  const o = opts || {};
  const state = {
    calls: [],
    projects: o.projects || [{ id: 24, title: 'Nexus Suite' }, { id: 8, title: 'Velumeron' }, { id: 3, title: 'Old', is_archived: true }],
    buckets: o.buckets || [
      { id: 1, title: 'Todo', position: 1, limit: 0 },
      { id: 2, title: 'Doing', position: 2, limit: 2 },
      { id: 3, title: 'Done', position: 3, limit: 0 },
    ],
    tasks: o.tasks || [
      { id: 101, title: 'Write docs', bucket_id: 1, position: 100, done: false, due_date: '0001-01-01T00:00:00Z', labels: [{ title: 'docs' }], description: '<p>First <b>line</b></p><p>Second</p>', priority: 2 },
      { id: 102, title: 'Ship it', bucket_id: 2, position: 100, done: false, due_date: '2026-10-20T10:00:00Z', labels: null, description: '' },
      { id: 103, title: 'Old thing', bucket_id: 3, position: 100, done: true, due_date: '0001-01-01T00:00:00Z' },
    ],
    pageSize: o.pageSize || 50,
    nextId: 200,
  };
  const json = (status, body, headers) => ({ status, json: body, text: JSON.stringify(body), headers: headers || {} });
  state.handler = async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const body = req.body ? JSON.parse(req.body) : null;
    state.calls.push(req.method + ' ' + path + url.search);
    if (req.headers.Authorization !== 'Bearer good') return json(401, { message: 'bad token' });
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const per = Math.min(parseInt(url.searchParams.get('per_page') || '50', 10), state.pageSize);
    let m;
    if (req.method === 'GET' && path === '/projects') {
      if (!url.searchParams.get('page')) return json(403, {});   // the WAF quirk
      const all = state.projects.concat([{ id: -1, title: 'Favorites' }]);
      return json(200, all.slice((page - 1) * per, page * per), { 'x-pagination-total-pages': String(Math.ceil(all.length / per)) });
    }
    if (req.method === 'GET' && (m = path.match(/^\/projects\/(\d+)\/views$/))) {
      return json(200, [{ id: 90, view_kind: 'list' }, { id: 91, view_kind: 'kanban', done_bucket_id: 3 }]);
    }
    if (req.method === 'GET' && (m = path.match(/^\/projects\/(\d+)\/views\/91\/tasks$/))) {
      const filter = url.searchParams.get('filter');
      const only = filter ? parseInt(filter.split('=')[1], 10) : null;
      const out = state.buckets.filter(b => only == null || b.id === only).map(b => {
        const all = state.tasks.filter(t => t.bucket_id === b.id).sort((x, y) => x.position - y.position);
        return Object.assign({}, b, { count: all.length, tasks: all.slice((page - 1) * per, page * per) });
      });
      return json(200, out);
    }
    if ((m = path.match(/^\/tasks\/(\d+)$/))) {
      const t = state.tasks.find(x => x.id === +m[1]);
      if (!t) return json(404, {});
      // Read outside a view: no bucket, position 0 — as the spec says.
      if (req.method === 'GET') return json(200, Object.assign({}, t, { bucket_id: undefined, position: 0 }));
      if (req.method === 'POST') {
        // Replaces every field it is sent, and wipes the ones it is not — the
        // quirk updateTask merges around. A bucket or position sent here is
        // applied, so leaking the view-less zeros back would show.
        const keep = { bucket_id: t.bucket_id, position: t.position };
        Object.keys(t).forEach(k => { if (k !== 'id') delete t[k]; });
        Object.assign(t, keep, body, { id: +m[1] });
        if (body.bucket_id === undefined) t.bucket_id = keep.bucket_id;
        if (t.done && t.bucket_id !== 3) t.bucket_id = 3;
        return json(200, t);
      }
    }
    if (req.method === 'POST' && (m = path.match(/^\/projects\/(\d+)\/views\/91\/buckets\/(\d+)\/tasks$/))) {
      const t = state.tasks.find(x => x.id === body.task_id);
      t.bucket_id = +m[2];
      t.done = +m[2] === 3;
      return json(200, body);
    }
    if (req.method === 'POST' && (m = path.match(/^\/tasks\/(\d+)\/position$/))) {
      state.tasks.find(x => x.id === +m[1]).position = body.position;
      return json(200, body);
    }
    if (req.method === 'PUT' && (m = path.match(/^\/projects\/(\d+)\/tasks$/))) {
      const t = { id: state.nextId++, title: body.title, bucket_id: 1, position: 999, done: false, due_date: '0001-01-01T00:00:00Z' };
      state.tasks.push(t);
      return json(201, t);
    }
    return json(404, { message: 'no route ' + req.method + ' ' + path });
  };
  return state;
}
module.exports = { fakeVikunja };
