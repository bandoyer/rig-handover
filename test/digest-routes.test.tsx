import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Fixtures are written to a temp runs dir. runs/ is never read or written here.
const GOOD_NIGHT = '2026-10-28';
const BAD_LINE_NIGHT = '2026-10-29';
const EMPTY_NIGHT = '2026-10-30';
const MISSING_NIGHT = '2026-10-31';

const lines = [
  { at: '2026-10-28T01:00:00+01:00', job: 'rotate-logs', status: 'retry', owner: null, error: 'disk busy' },
  { at: '2026-10-28T01:05:00+01:00', job: 'rotate-logs', status: 'retry', owner: null },
  { at: '2026-10-28T01:10:00+01:00', job: 'rotate-logs', status: 'retry', owner: null },
  { at: '2026-10-28T02:00:00+01:00', job: 'backup-db', status: 'ok', owner: 'ben' },
  { at: '2026-10-28T02:30:00+01:00', job: 'sync-mail', status: 'ok', owner: 'ana' },
  { at: '2026-10-28T03:00:00+01:00', job: 'sync-mail', status: 'fail', owner: 'ana', error: 'auth refused' },
  { at: '2026-10-28T04:00:00+01:00', job: 'build-index', status: 'ok', owner: null },
];

// Jobs in the order the page and the JSON must both use: sorted by job.
const JOBS = ['backup-db', 'build-index', 'rotate-logs', 'sync-mail'];

const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';

let dir: string;

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
}

// Splits the page into table rows. The chunk that holds a job name is that job's row.
function rowFor(html: string, job: string): string {
  const chunk = html.split('<tr').find((part) => part.includes(job));
  if (chunk === undefined) throw new Error(`no table row for ${job}`);
  return chunk;
}

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(dir, `${GOOD_NIGHT}.jsonl`), jsonl(lines));
  // The same lines with one line that does not parse, in the middle of the file.
  writeFileSync(
    join(dir, `${BAD_LINE_NIGHT}.jsonl`),
    jsonl([...lines.slice(0, 3), 'this line is not json', ...lines.slice(3)]),
  );
  writeFileSync(join(dir, `${EMPTY_NIGHT}.jsonl`), '');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('shows the lane banner and one warn-marked row per job for a normal night', async () => {
    const res = await app().request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    for (const job of JOBS) expect(html).toContain(job);

    // retries >= 3 and fails > 0 are warn; a clean job is not.
    expect(rowFor(html, 'rotate-logs')).toContain('class="warn"');
    expect(rowFor(html, 'sync-mail')).toContain('class="warn"');
    expect(rowFor(html, 'backup-db')).not.toContain('class="warn"');
    expect(rowFor(html, 'build-index')).not.toContain('class="warn"');

    // null owner and null error render as an em dash.
    expect(rowFor(html, 'build-index')).toContain('—');
    expect(html).not.toContain('could not be read');
  });

  it('returns 404 with the message for a night with no file', async () => {
    const res = await app().request(`/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING_NIGHT}`);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app().request(`/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('reports the bad line under the table and still shows the other rows', async () => {
    const res = await app().request(`/digest/${BAD_LINE_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    for (const job of JOBS) expect(html).toContain(job);
  });

  it('answers 404 for a night that is not YYYY-MM-DD, after a valid night answers 200', async () => {
    expect((await app().request(`/digest/${GOOD_NIGHT}`)).status).toBe(200);
    for (const bad of ['not-a-night', '2026-1-8']) {
      expect((await app().request(`/digest/${bad}`)).status).toBe(404);
    }
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON with one row per job for a normal night', async () => {
    const res = await app().request(`/api/digest/${GOOD_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe(GOOD_NIGHT);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 3, retry: 3, fail: 1 });
    expect(body.rows.map((row) => row.job)).toEqual(JOBS);
    expect(body.rows[0]).toMatchObject({
      job: 'backup-db',
      owner: 'ben',
      runs: 1,
      retries: 0,
      fails: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T02:00:00+01:00',
      lastAt: '2026-10-28T02:00:00+01:00',
    });
    expect(body.rows[1]).toMatchObject({ job: 'build-index', owner: null, lastError: null });
    expect(body.rows[2]).toMatchObject({
      job: 'rotate-logs',
      owner: null,
      runs: 3,
      retries: 3,
      fails: 0,
      lastStatus: 'retry',
      firstAt: '2026-10-28T01:00:00+01:00',
      lastAt: '2026-10-28T01:10:00+01:00',
    });
    expect(body.rows[3]).toMatchObject({
      job: 'sync-mail',
      owner: 'ana',
      runs: 2,
      retries: 0,
      fails: 1,
      lastStatus: 'fail',
      lastError: 'auth refused',
      firstAt: '2026-10-28T02:30:00+01:00',
      lastAt: '2026-10-28T03:00:00+01:00',
    });
  });

  it('returns 404 JSON for a night with no file', async () => {
    const res = await app().request(`/api/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING_NIGHT });
  });

  it('returns an empty night with no rows', async () => {
    const res = await app().request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY_NIGHT,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts the bad line and still returns the other rows', async () => {
    const res = await app().request(`/api/digest/${BAD_LINE_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(JOBS);
    expect(body.counts).toEqual({ ok: 3, retry: 3, fail: 1 });
  });

  it('answers 404 for a night that is not YYYY-MM-DD, after a valid night answers 200', async () => {
    expect((await app().request(`/api/digest/${GOOD_NIGHT}`)).status).toBe(200);
    for (const bad of ['not-a-night', '2026-1-8']) {
      expect((await app().request(`/api/digest/${bad}`)).status).toBe(404);
    }
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app().request(`/digest/${GOOD_NIGHT}`)).text();
    const body = (await (await app().request(`/api/digest/${GOOD_NIGHT}`)).json()) as Night;
    const jsonJobs = body.rows.map((row) => row.job);

    for (const job of jsonJobs) expect(html.indexOf(job)).toBeGreaterThanOrEqual(0);
    const jobsInPageOrder = [...jsonJobs].sort((a, b) => html.indexOf(a) - html.indexOf(b));
    expect(jobsInPageOrder).toEqual(jsonJobs);
  });
});
