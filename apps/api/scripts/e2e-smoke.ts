/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * End-to-end HTTP smoke test — drives the exact endpoints the web app calls,
 * against a RUNNING API server and a real Postgres target. This catches
 * integration regressions that unit tests miss (SSE streaming, BigInt counts,
 * pagination, ordering, conversational routing).
 *
 * Prereqs:
 *   1. API running:   pnpm --filter api dev          (defaults to :3001)
 *   2. A Postgres:    docker run -d --name qs-e2e -e POSTGRES_PASSWORD=postgres \
 *                       -e POSTGRES_DB=shop -p 55432:5432 postgres:16
 *
 * Run:   E2E_PG_PORT=55432 pnpm --filter api e2e
 *
 * Env (all optional):
 *   E2E_API_URL  (default http://localhost:3001/api/v1)
 *   E2E_PG_HOST  (default 127.0.0.1)   E2E_PG_PORT (default 5432)
 *   E2E_PG_DB    (default shop)         E2E_PG_USER (default postgres)
 *   E2E_PG_PASSWORD (default postgres)
 *
 * Exits 0 if every check passes, 1 otherwise.
 */
import { Client } from 'pg';

const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api/v1';
const PG = {
  engine: 'postgres' as const,
  host: process.env.E2E_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.E2E_PG_PORT ?? 5432),
  databaseName: process.env.E2E_PG_DB ?? 'shop',
  username: process.env.E2E_PG_USER ?? 'postgres',
  password: process.env.E2E_PG_PASSWORD ?? 'postgres',
};

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const skip = (name: string, why: string) => {
  skipped++;
  console.log(`  ⏭️  ${name} — ${why}`);
};
const noAiQuota = (err: string | null) =>
  !!err &&
  /providers? (failed|are not configured)|rate|configured|quota|AI service|temporarily unavailable/i.test(
    err,
  );

function unwrap(parsed: any) {
  if (parsed && typeof parsed === 'object' && 'success' in parsed && 'data' in parsed)
    return parsed.data;
  return parsed;
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? unwrap(JSON.parse(text)) : null };
}

/** POST an SSE endpoint and return the parsed `done` event + collected steps. */
async function sse(
  path: string,
  token: string,
  body: unknown,
): Promise<{ done: any; steps: string[]; error: string | null }> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let cur = '';
  let done: any = null;
  let error: string | null = null;
  const steps: string[] = [];
  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) cur = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (cur === 'step') steps.push(payload);
        else if (cur === 'done') done = JSON.parse(payload);
        else if (cur === 'error') error = payload;
      }
    }
  }
  return { done, steps, error };
}

/** SSE call with retry — the AI generation/chat steps depend on a live LLM that
 *  may transiently rate-limit; the deterministic pipeline around it must not flake. */
async function sseRetry(path: string, token: string, body: unknown, tries = 3) {
  let last: Awaited<ReturnType<typeof sse>> = { done: null, steps: [], error: 'no attempt' };
  for (let i = 0; i < tries; i++) {
    last = await sse(path, token, body);
    if (last.done) return last;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
  }
  return last;
}

async function seed() {
  const client = new Client({
    host: PG.host,
    port: PG.port,
    database: PG.databaseName,
    user: PG.username,
    password: PG.password,
  });
  await client.connect();
  await client.query('DROP TABLE IF EXISTS orders');
  await client.query('DROP TABLE IF EXISTS products');
  await client.query(
    'CREATE TABLE orders (id SERIAL PRIMARY KEY, shipping_country VARCHAR(50) NOT NULL, total_amount NUMERIC(10,2) NOT NULL)',
  );
  await client.query(`INSERT INTO orders (shipping_country, total_amount) VALUES
    ('France',39.99),('China',799.00),('Australia',24.99),('UK',87.49),
    ('Spain',1099.00),('USA',716.88),('Canada',699.00),('South Korea',204.74),('Mexico',1299.00)`);
  await client.query(
    'CREATE TABLE products (id SERIAL PRIMARY KEY, name VARCHAR(100), price NUMERIC(10,2))',
  );
  await client.query(
    "INSERT INTO products (name, price) VALUES ('Widget',9.99),('Gadget',19.99),('Gizmo',1299.00)",
  );
  await client.end();
}

const firstCountry = (r: any) =>
  (r?.data?.rows?.[0] ?? {}).shipping_country as string | undefined;

async function main() {
  console.log(`API: ${API}\nPostgres: ${PG.host}:${PG.port}/${PG.databaseName}\n`);

  console.log('[0] Seed Postgres');
  try {
    await seed();
    check('seeded orders + products', true);
  } catch (e: any) {
    check('seeded orders + products', false, e.message);
    finish();
    return;
  }

  console.log('\n[1] Register + auth');
  const email = `e2e${Date.now()}@test.com`;
  const reg = await api('POST', '/auth/register', {
    body: { email, name: 'E2E Test', password: 'E2ePass123!' },
  });
  const token = reg.data?.accessToken;
  check('register returns access token', !!token, JSON.stringify(reg.data).slice(0, 160));
  if (!token) return finish();

  console.log('\n[2] Workspace');
  const wsRes = await api('GET', '/workspaces', { token });
  const wsList = Array.isArray(wsRes.data) ? wsRes.data : wsRes.data?.items ?? [];
  const wsid = wsList[0]?.id;
  check('workspace exists for new user', !!wsid);
  if (!wsid) return finish();

  console.log('\n[3] Test + create connection');
  const t = await api('POST', `/workspaces/${wsid}/connections/test`, { token, body: PG });
  check('test connection succeeds', t.status < 400, `status=${t.status}`);
  const conn = await api('POST', `/workspaces/${wsid}/connections`, {
    token,
    body: { name: 'E2E PG', ...PG },
  });
  const cid = conn.data?.id;
  check('connection created (engine=postgres)', !!cid && conn.data?.engine === 'postgres');
  if (!cid) return finish();

  console.log('\n[4] Sync schema');
  const sync = await api('POST', `/workspaces/${wsid}/connections/${cid}/sync`, { token, body: {} });
  check('schema sync ran', sync.status < 400, `status=${sync.status}`);

  console.log('\n[5] Conversation + ask (SSE)');
  const conv = await api('POST', `/workspaces/${wsid}/conversations`, {
    token,
    body: { connectionId: cid, title: 'E2E' },
  });
  const cvid = conv.data?.id;
  check('conversation created', !!cvid);
  if (!cvid) return finish();

  // Mint a message id WITHOUT the LLM (import-record) so the deterministic core
  // (execute, pagination, ordering) never depends on AI provider availability.
  const rec = await api('POST', `/workspaces/${wsid}/conversations/${cvid}/import-record`, {
    token,
    body: { userContent: 'pagination probe', assistantContent: 'probe' },
  });
  const mid = rec.data?.assistantMessage?.id;
  check('message minted (no LLM needed)', !!mid, JSON.stringify(rec.data).slice(0, 140));
  if (!mid) return finish();

  // Pagination/ordering are tested with a deterministic ORDER BY query — the
  // model's output is non-deterministic (sometimes omits ORDER BY), and an
  // unordered result can't be paginated stably by definition.
  const pagedSql =
    'SELECT shipping_country, total_amount FROM orders ORDER BY total_amount DESC LIMIT 500';
  const exec1 = (page: number, pageSize: number) =>
    api('POST', `/workspaces/${wsid}/conversations/${cvid}/messages/${mid}/execute`, {
      token,
      body: { sql: pagedSql, connectionId: cid, page, pageSize },
    });

  console.log('\n[6] Execute');
  const r = await exec1(1, 50);
  check('execute returned 9 rows', Array.isArray(r.data?.rows) && r.data.rows.length === 9);
  check(
    'totalCount serialized (no BigInt crash)',
    ['number', 'string'].includes(typeof r.data?.totalCount),
    `totalCount=${JSON.stringify(r.data?.totalCount)}`,
  );

  console.log('\n[7] Pagination');
  const p1 = await exec1(1, 4);
  const p2 = await exec1(2, 4);
  const p3 = await exec1(3, 4);
  check('page 2 honored', p2.data?.page === 2, `page=${p2.data?.page}`);
  check('page sizes 4/4/1', p1.data?.rows?.length === 4 && p2.data?.rows?.length === 4 && p3.data?.rows?.length === 1);
  check('totalCount=9 totalPages=3', Number(p2.data?.totalCount) === 9 && p2.data?.totalPages === 3);
  check('pages are different slices', firstCountry(p1) !== firstCountry(p2) && firstCountry(p2) !== firstCountry(p3));

  console.log('\n[8] Ordering integrity (ORDER BY preserved across pages)');
  // The generated query is `... ORDER BY average_order_value DESC LIMIT 500`.
  // Paging it must NOT reorder rows (pageSize >= total so this is the full set).
  const full = await exec1(1, 50);
  const fullOrder: string[] = (full.data?.rows ?? []).map((x: any) => x.shipping_country);
  const pagedOrder: string[] = [
    ...(p1.data?.rows ?? []),
    ...(p2.data?.rows ?? []),
    ...(p3.data?.rows ?? []),
  ].map((x: any) => x.shipping_country);
  check('paged order == single-shot order', JSON.stringify(pagedOrder) === JSON.stringify(fullOrder),
    `paged=${pagedOrder.join(',')} full=${fullOrder.join(',')}`);
  const vals = (full.data?.rows ?? []).map((x: any) => Number(x.total_amount));
  const desc = vals.every((v: number, i: number) => i === 0 || vals[i - 1] >= v);
  check('result is sorted DESC (order preserved across pages)', desc, vals.join(','));
  check('Mexico is first (highest)', fullOrder[0] === 'Mexico', `first=${fullOrder[0]}`);

  // ── LLM-dependent steps (best-effort: skip cleanly if AI quota is unavailable) ──
  console.log('\n[9] NL→SQL generation (needs AI)');
  const gen = await sseRetry(`/workspaces/${wsid}/conversations/${cvid}/messages`, token, {
    content: "What's the average order value by country?",
    connectionId: cid,
  });
  let genMid: string | undefined;
  let genSql: string | undefined;
  if (gen.done?.type === 'sql_ready') {
    check('SSE emitted progress steps', gen.steps.length > 0, `${gen.steps.length} steps`);
    check('generation returned ready SQL', true);
    genMid = gen.done?.message?.id;
    genSql = gen.done?.message?.generatedSql;
    check('generated SQL present', !!genSql);
  } else if (noAiQuota(gen.error)) {
    skip('NL→SQL generation', `AI providers unavailable (${gen.error})`);
  } else {
    check('generation returned ready SQL', false, `type=${gen.done?.type} error=${gen.error ?? ''}`);
  }

  console.log('\n[10] Conversational follow-up (CHAT, no re-query) (needs AI)');
  if (genMid && genSql) {
    // Populate the prior result so the follow-up has grounded context.
    await api('POST', `/workspaces/${wsid}/conversations/${cvid}/messages/${genMid}/execute`, {
      token,
      body: { sql: genSql, connectionId: cid, page: 1, pageSize: 50 },
    });
    await new Promise((r) => setTimeout(r, 1500));
    const chat = await sseRetry(`/workspaces/${wsid}/conversations/${cvid}/messages`, token, {
      content: 'So Mexico is the highest, correct?',
      connectionId: cid,
    });
    if (chat.done?.type === 'chat') {
      check('follow-up routed to CHAT', true);
      check('CHAT reply mentions Mexico', /mexico/i.test(chat.done?.message?.content ?? ''),
        (chat.done?.message?.content ?? '').slice(0, 140));
    } else if (noAiQuota(chat.error)) {
      skip('conversational follow-up', `AI providers unavailable (${chat.error})`);
    } else {
      check('follow-up routed to CHAT', false, `type=${chat.done?.type} error=${chat.error ?? ''}`);
    }
  } else {
    skip('conversational follow-up', 'generation unavailable, no context to follow up on');
  }

  finish();
}

function finish() {
  console.log(
    `\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E CRASHED:', e);
  process.exit(2);
});
