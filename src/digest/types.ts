// Types for the night's run log reader (plan.md § 1). No reader logic here.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One parsed line of runs/<night>.jsonl.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times are the `at` strings exactly as in the log, offset kept.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number; // lines for this job
  retries: number; // lines with status "retry"
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse
};

// Reads runs/<night>.jsonl from runsDir. Returns null when the night has no file.
// An empty file gives rows []. A line that doesn't parse is counted in badLines, never thrown.
export type ReadNight = (runsDir: string, night: string) => Night | null;
