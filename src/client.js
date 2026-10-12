'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA · the Vikunja REST client
 *  Bearer token against /api/v1, through Obsidian's requestUrl so it runs on
 *  mobile too and has no CORS to argue with. Only what the boards need.
 *
 *  Two server quirks it has to live with:
 *  - Lists are always fetched PAGED. On this server the bare /projects call is
 *    refused by the proxy's WAF (403); the paged form passes.
 *  - POST /tasks/{id} REPLACES the task with what is sent. A patch is merged
 *    onto the task as it is now, or every field not sent is wiped.
 * ========================================================================== */

const { requestUrl } = require('obsidian');

const PER_PAGE = 50;
const NO_DATE = /^0001-01-01/;   // Vikunja's "no date"
const VIEW_FIELDS = ['bucket_id', 'buckets', 'position', 'kanban_position'];

class VikunjaError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

class VikunjaClient {
  constructor(opts) {
    // Whatever was pasted — the web address, with or without /api/v1 — is cut
    // back to scheme://host[/path] before the API path is added.
    this.base = String(opts.url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    this.token = String(opts.token || '').trim();
  }

  async request(method, path, body) {
    if (!this.base) throw new VikunjaError('no Vikunja address is set', 0);
    if (!this.token) throw new VikunjaError('no API token on this device', 0);
    let res;
    try {
      res = await requestUrl({
        url: this.base + '/api/v1' + path, method,
        headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
        throw: false,
      });
    } catch (e) {
      throw new VikunjaError('the server could not be reached (' + (e && e.message ? e.message : e) + ')', 0);
    }
    if (res.status === 401) throw new VikunjaError('the API token was refused — it may have expired', 401);
    if (res.status < 200 || res.status >= 300) {
      throw new VikunjaError(method + ' ' + path + ' failed with ' + res.status, res.status);
    }
    return res;
  }

  /* Every page of a list. Stops at the last page the server announces, or at
     the first short page when it announces none. */
  async paged(path) {
    const out = [];
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    for (let page = 1; page <= 100; page++) {
      const res = await this.request('GET', path + sep + 'per_page=' + PER_PAGE + '&page=' + page);
      const items = Array.isArray(res.json) ? res.json : [];
      out.push(...items);
      const headers = res.headers || {};
      const total = parseInt(headers['x-pagination-total-pages'] || headers['X-Pagination-Total-Pages'] || '0', 10);
      if (total ? page >= total : items.length < PER_PAGE) break;
    }
    return out;
  }

  async projects() {
    const all = await this.paged('/projects');
    // Negative ids are Vikunja's pseudo projects (Favorites), not real ones.
    return all.filter(p => p && p.id > 0);
  }

  async kanbanView(projectId) {
    const res = await this.request('GET', '/projects/' + projectId + '/views');
    const views = Array.isArray(res.json) ? res.json : [];
    // view_kind is "kanban" on current servers; older ones sent the number 3.
    return views.find(v => v && (String(v.view_kind).toLowerCase() === 'kanban' || v.view_kind === 3)) || null;
  }

  /* The buckets of a kanban view, each with ALL its tasks. The view answers
     with the first page of every bucket; a bucket whose `count` says there is
     more is fetched on, page by page, filtered to that bucket. */
  async buckets(projectId, viewId) {
    const base = '/projects/' + projectId + '/views/' + viewId + '/tasks';
    const first = await this.request('GET', base + '?per_page=' + PER_PAGE + '&page=1');
    const buckets = (Array.isArray(first.json) ? first.json : []).map(b => Object.assign({}, b, { tasks: (b.tasks || []).slice() }));
    for (const bucket of buckets) {
      for (let page = 2; bucket.count > bucket.tasks.length && page <= 100; page++) {
        const res = await this.request('GET', base + '?per_page=' + PER_PAGE + '&page=' + page
          + '&filter=' + encodeURIComponent('bucket_id = ' + bucket.id));
        const more = moreTasksOf(res.json, bucket.id);
        if (!more.length) break;
        bucket.tasks.push(...more);
      }
    }
    return buckets.sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  async task(id) { return (await this.request('GET', '/tasks/' + id)).json; }

  async updateTask(id, patch) {
    const current = await this.task(id);
    // Read outside a view a task has no bucket and position 0; posting those
    // back could move it to the top of the default bucket. They are changed
    // only through their own endpoints (moveToBucket, setPosition).
    for (const viewField of VIEW_FIELDS) delete current[viewField];
    return (await this.request('POST', '/tasks/' + id, Object.assign({}, current, patch))).json;
  }

  async createTask(projectId, fields) {
    return (await this.request('PUT', '/projects/' + projectId + '/tasks', fields)).json;
  }

  async moveToBucket(projectId, viewId, bucketId, taskId) {
    const body = { task_id: taskId, bucket_id: bucketId, project_view_id: viewId };
    return (await this.request('POST', '/projects/' + projectId + '/views/' + viewId + '/buckets/' + bucketId + '/tasks', body)).json;
  }

  async setPosition(taskId, viewId, position) {
    const body = { task_id: taskId, project_view_id: viewId, position };
    return (await this.request('POST', '/tasks/' + taskId + '/position', body)).json;
  }
}

/* A filtered page comes back either as buckets again or as plain tasks,
   depending on the server version. */
function moreTasksOf(json, bucketId) {
  const list = Array.isArray(json) ? json : [];
  if (list.length && Array.isArray(list[0].tasks)) {
    const hit = list.find(b => b.id === bucketId);
    return hit ? hit.tasks || [] : [];
  }
  return list;
}

/* "2026-10-20" in local time, or '' for Vikunja's empty date. */
function dayOf(rfc) {
  if (!rfc || NO_DATE.test(rfc)) return '';
  const d = new Date(rfc);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* Local midnight of a "YYYY-MM-DD" day as the timestamp Vikunja stores, or its
   empty date for ''. */
function dueOf(day) {
  if (!day) return '0001-01-01T00:00:00Z';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

/* Vikunja descriptions are HTML. Plain text with paragraph breaks kept. */
function plainText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { VikunjaClient, VikunjaError, dayOf, dueOf, plainText, moreTasksOf, PER_PAGE };
