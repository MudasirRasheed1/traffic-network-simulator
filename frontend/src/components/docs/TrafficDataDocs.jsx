// =====================================================
// DOCS: USING YOUR OWN TRAFFIC DATA
// What a file for the 'From data file' inflow function may contain and
// how it becomes cars per step. Column names come from dataInflow.js so
// the page and the reader never disagree.
// =====================================================
import { COLUMN_NAMES, DATA_FILE_ACCEPT, SKEW_STRENGTHS } from '../../simulation/dataInflow.js';
import styles from './TrafficDataDocs.module.css';

const SAMPLE_MOMENTS = `time,vehicles
08:00:00,2
08:00:04,1
08:00:09,3
08:00:15,0
08:00:22,4
08:00:31,2
08:00:38,1
08:00:47,3
08:00:55,2
08:01:00,1
`;

const SAMPLE_PERIODS = `start,end,vehicles,spread
08:00,08:15,120,left-high
08:15,08:30,210,center-medium
08:30,08:45,260,even
08:45,09:00,150,
`;

const SAMPLE_SOURCES = `time,G1,G2,G3
0,2,1,0
5,1,0,2
10,3,2,1
15,0,1,1
`;

const SAMPLE_JSON = `[
  { "start": "08:00", "end": "08:15", "vehicles": 120 },
  { "start": "08:15", "end": "08:30", "vehicles": 210 }
]`;

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const names = (list) => list.map((n) => <code key={n}>{n}</code>);

export default function TrafficDataDocs({ docStyles }) {
  return (
    <section id="traffic-data" className={docStyles.section}>
      <div className={docStyles.sectionHeader}>
        <span className={docStyles.sectionNumber}>08</span>
        <h2>Using Your Own Traffic Data</h2>
      </div>
      <p>
        Any source can take its traffic from a file of counts. Open a source's inflow settings, choose
        <strong> Function</strong>, then <strong>From data file</strong>, and load the file. It works the same in the Grid
        Simulator (a side or one entry point) and the City Simulator (one source, or all with Apply to all sources).
      </p>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h4>Files</h4>
          <ul>
            <li>CSV, TSV or TXT (comma, semicolon, tab or spaces between columns)</li>
            <li>Excel .xlsx (first sheet)</li>
            <li>JSON: a list of rows, or {'{ "rows": [...] }'}</li>
            <li>First row: column names</li>
            <li>Accepted: <code>{DATA_FILE_ACCEPT}</code></li>
          </ul>
        </div>
        <div className={styles.card}>
          <h4>Times</h4>
          <ul>
            <li>Seconds: <code>0</code>, <code>12.5</code></li>
            <li>Clock: <code>08:00</code>, <code>08:00:05</code>, <code>8:30 pm</code></li>
            <li>Date and time: <code>2026-10-26 08:00:05</code></li>
            <li>Clock times may pass midnight</li>
          </ul>
        </div>
      </div>

      <h3 className={styles.subhead}>Column names</h3>
      <p className={styles.small}>Not case-sensitive. Spaces and dashes count as underscores.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Meaning</th><th>Accepted names</th></tr></thead>
          <tbody>
            <tr><td>A moment (case 1)</td><td>{names(COLUMN_NAMES.time)}</td></tr>
            <tr><td>Period start (case 2)</td><td>{names(COLUMN_NAMES.start)}</td></tr>
            <tr><td>Period end (case 2, optional)</td><td>{names(COLUMN_NAMES.end)}</td></tr>
            <tr><td>Whole period in one cell</td><td>{names(COLUMN_NAMES.interval)}, written <code>08:00-08:15</code></td></tr>
            <tr><td>Cars</td><td>{names(COLUMN_NAMES.count)}</td></tr>
            <tr><td>Spread of a period (optional)</td><td>{names(COLUMN_NAMES.spread)}, codes below</td></tr>
            <tr><td>One column per source</td><td>the source's name, for example <code>G3</code> (city), <code>N</code> for a grid side or <code>r0c1N</code> for one grid entry point. Picked automatically.</td></tr>
          </tbody>
        </table>
      </div>
      <ul className={styles.points}>
        <li>A time column means case 1; a start or interval column means case 2. You can switch in the panel.</li>
        <li>No cars column: every row is one car (a detector log).</li>
        <li>No end column: a period ends where the next one starts. The last one is as long as the one before.</li>
        <li>Use one time format in every file (plain seconds, clock times or dates), so the files line up.</li>
      </ul>

      <h3 className={styles.subhead}>One clock for every source</h3>
      <ul className={styles.points}>
        <li>Step 0 is the earliest time in any loaded file. Every source counts its steps from there, so files that start at different times stay in sync.</li>
        <li>You can set a later start in the panel (Start at). Cars before it are dropped.</li>
        <li>All sources share one step length. In the City Simulator it is the simulator's own step (5 seconds), which also sets how long cars take on each road.</li>
      </ul>
      <p className={styles.formula}>step = floor((time - step 0 time) / seconds per step)</p>
      <p className={styles.small}>
        The clock is cut into windows of one step each. Every row puts its cars into the windows it covers: a moment into one window,
        a period into all the windows it overlaps, in proportion to the time it spends in each.
      </p>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h4>Case 1: time and cars</h4>
          <ul>
            <li>All cars of a row go into the window of its time</li>
            <li>Rows in the same window are added</li>
            <li>Windows without rows get 0 cars</li>
          </ul>
          <table className={styles.table}>
            <thead><tr><th>Time</th><th>Cars</th><th>Step</th></tr></thead>
            <tbody>
              <tr><td>08:00:02</td><td>3</td><td>0</td></tr>
              <tr><td>08:00:04</td><td>1</td><td>0</td></tr>
              <tr><td>08:00:11</td><td>2</td><td>1</td></tr>
              <tr><td>08:00:23</td><td>1</td><td>4</td></tr>
            </tbody>
          </table>
          <p className={styles.small}>Cars per step: <code>[4, 2, 0, 0, 1]</code></p>
        </div>

        <div className={styles.card}>
          <h4>Case 2: period and cars</h4>
          <p className={styles.small}>Each period covers several windows (steps). Its cars are shared across them, equally or skewed; the total stays exact. Example: 12 cars over 6 windows.</p>
          <table className={styles.table}>
            <thead><tr><th>Distribution</th><th>Cars per window</th></tr></thead>
            <tbody>
              <tr><td>Equal</td><td><code>2, 2, 2, 2, 2, 2</code></td></tr>
              <tr><td>Skewed, Left, Medium</td><td>about <code>4, 3, 2, 2, 1, 0</code></td></tr>
              <tr><td>Skewed, Center, High</td><td>about <code>0, 2, 4, 4, 2, 0</code></td></tr>
              <tr><td>Skewed, Right, Low</td><td>about <code>1, 1, 2, 2, 3, 3</code></td></tr>
            </tbody>
          </table>
          <ul>
            <li>Direction: where most cars land (Left = first windows, Center = middle, Right = last)</li>
            <li>Skewness: {Object.values(SKEW_STRENGTHS).map((s) => s.label).join(', ')} (Low leans gently, High packs most cars into a few windows)</li>
            <li>Each window gets its share rounded down or up; the extra cars go to random windows, fixed by the seed, so both policies get the same cars</li>
            <li>A period partly before the start or after the run keeps only its part inside</li>
          </ul>
        </div>
      </div>

      <h3 className={styles.subhead}>Spread codes (the spread column)</h3>
      <p className={styles.small}>One code per period row. Empty cells use the default spread set in the panel, which is shared by every source. One code covers every source column of its row.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Code</th><th>Cars across the period's windows</th></tr></thead>
          <tbody>
            <tr><td><code>equal</code></td><td>About the same number in every window</td></tr>
            <tr><td><code>left-low</code> <code>left-medium</code> <code>left-high</code></td><td>Most cars in the first windows</td></tr>
            <tr><td><code>center-low</code> <code>center-medium</code> <code>center-high</code></td><td>Most cars in the middle windows</td></tr>
            <tr><td><code>right-low</code> <code>right-medium</code> <code>right-high</code></td><td>Most cars in the last windows</td></tr>
          </tbody>
        </table>
      </div>
      <p className={styles.small}>
        The ending is the skewness: low leans gently, high packs most cars into a few windows. Codes are not case-sensitive;
        spaces work as dashes (<code>Left High</code>). Unknown codes are listed by row. Codes from older files
        (<code>even</code>, <code>random</code>, <code>peak-30-high</code>) still work.
      </p>

      <h3 className={styles.subhead}>Rules</h3>
      <ul className={styles.points}>
        <li>A run may be longer than the data: after the data ends, that source sends no cars.</li>
        <li>Data after the end of the run is not used.</li>
        <li>Moments ignore the spread column; all their cars land in one window.</li>
        <li>Rows that cannot be read are listed by line number, and the file is not applied until they are fixed.</li>
        <li>Counts are used as they are, with no per-step cap.</li>
      </ul>

      <h3 className={styles.subhead}>Sample files</h3>
      <div className={styles.samples}>
        <button type="button" onClick={() => download('sample-time-and-cars.csv', SAMPLE_MOMENTS)}>Time and cars (CSV)</button>
        <button type="button" onClick={() => download('sample-periods.csv', SAMPLE_PERIODS)}>Periods (CSV)</button>
        <button type="button" onClick={() => download('sample-one-column-per-source.csv', SAMPLE_SOURCES)}>One column per source (CSV)</button>
      </div>
      <pre className={styles.code}>{SAMPLE_JSON}</pre>
    </section>
  );
}
