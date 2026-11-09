import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const dirs: string[] = [];

function tempRuns(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives one row per job, sorted by job, and counts the bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps a job whose owner is null', () => {
    const row = night?.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('counts retries and keeps the last error after a later ok', () => {
    const row = night?.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('counts fails', () => {
    const row = night?.rows.find((r) => r.job === 'notes/backup');
    expect(row).toMatchObject({ fails: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps the offset on times, exactly as logged', () => {
    const row = night?.rows.find((r) => r.job === 'lane/sync');
    expect(row?.firstAt).toBe('2026-10-28T23:00:06+01:00');
    expect(row?.lastAt).toBe('2026-10-29T05:00:04+01:00');
  });
});

describe('readNight edge cases', () => {
  it('returns null for a night with no file', () => {
    expect(readNight(tempRuns({}), '2026-10-30')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    const dir = tempRuns({ 'latest.jsonl': '' });
    expect(readNight(dir, 'latest')).toBeNull();
    expect(readNight(dir, '../runs/2026-10-28')).toBeNull();
  });

  it('gives no rows and zero counts for an empty file', () => {
    expect(readNight(tempRuns({ '2026-10-30.jsonl': '' }), '2026-10-30')).toEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('ignores blank lines and counts malformed lines without throwing', () => {
    const lines = [
      '{"at":"2026-10-30T01:00:00+02:00","job":"a","status":"ok","owner":"x"}',
      '',
      '   ',
      'not json',
      '[]',
      '{"job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-10-30T02:00:00+02:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-10-30T02:00:00+02:00","job":"a","status":"ok"}',
      '{"at":"2026-10-30T02:00:00+02:00","job":"a","status":"ok","owner":7}',
      '{"at":"2026-10-30T03:00:00+02:00","job":"a","status":"fail","owner":null,"error":"boom"}',
    ];
    const night = readNight(tempRuns({ '2026-10-30.jsonl': lines.join('\n') + '\n' }), '2026-10-30');
    expect(night?.badLines).toBe(6);
    expect(night?.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
    expect(night?.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 2,
        retries: 0,
        fails: 1,
        lastStatus: 'fail',
        lastError: 'boom',
        firstAt: '2026-10-30T01:00:00+02:00',
        lastAt: '2026-10-30T03:00:00+02:00',
      },
    ]);
  });
});
