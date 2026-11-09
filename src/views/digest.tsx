import type { DigestRow, Night } from '../digest/types.js';

// Missing data shows as "—" (styleguide). Times are the log's strings, offset kept.
const dash = (value: string | null) => value ?? '—';

function Row({ row }: { row: DigestRow }) {
  const warn = row.retries >= 3 || row.fails > 0;
  return (
    <tr class={warn ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{dash(row.owner)}</td>
      <td>{row.runs}</td>
      <td>{row.retries}</td>
      <td>{row.lastStatus}</td>
      <td>{dash(row.lastError)}</td>
      <td>{row.firstAt}</td>
      <td>{row.lastAt}</td>
    </tr>
  );
}

export function DigestView({ night }: { night: Night }) {
  return (
    <>
      <h1>{night.night}</h1>
      {night.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {night.rows.map((row) => (
              <Row row={row} />
            ))}
          </tbody>
        </table>
      )}
      {night.badLines > 0 && (
        <p class="warn">
          {night.badLines} {night.badLines === 1 ? 'line' : 'lines'} could not be read
        </p>
      )}
    </>
  );
}
