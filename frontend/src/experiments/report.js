// =====================================================
// EXTRACT DETAILS: PDF REPORT AND CSV
// =====================================================
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LEVELS, PATTERNS, labelOf } from './plan.js';
import { chartImage, intersectionChart, levelChart, patternChart, runsChart, scenarioChart, throughputChart, timeChart } from './charts.js';
import { pct } from './analysis.js';
import { improvement } from '../simulation/cityMetrics.js';

const MARGIN = 40;
const INK = [30, 41, 59];
const MUTED = [100, 116, 139];
const HEAD = [15, 23, 42];

// The PDF's built-in fonts have no true minus sign or arrows.
const clean = (v) => (typeof v === 'string' ? v.replace(/−/g, '-').replace(/→/g, '->') : v);

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/**
 * @param analysis  output of analyze()
 * @param results   the finished runs
 * @param setup     { title, network, rows: [[label, value]] }
 */
export function downloadReport(analysis, results, setup) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = pageW - 2 * MARGIN;
  let y = MARGIN;

  const ensure = (h) => {
    if (y + h > pageH - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const heading = (text, size = 13) => {
    ensure(size + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    doc.text(text, MARGIN, y + size);
    y += size + 10;
  };
  const paragraph = (text, { size = 10, bold = false, color = INK, indent = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(clean(text), width - indent);
    ensure(lines.length * (size + 3) + 4);
    doc.text(lines, MARGIN + indent, y + size);
    y += lines.length * (size + 3) + 4;
  };
  const table = (head, body, opts = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(clean)],
      body: body.map((row) => row.map(clean)),
      margin: { left: MARGIN, right: MARGIN },
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, textColor: INK },
      headStyles: { fillColor: HEAD, textColor: [241, 245, 249] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      ...opts,
    });
    y = doc.lastAutoTable.finalY + 14;
  };
  const chart = (config, caption, h = 230) => {
    if (!config) return;
    ensure(h + 30);
    const img = chartImage(config, 1000, Math.round((1000 * h) / width));
    doc.addImage(img, 'JPEG', MARGIN, y, width, h, undefined, 'FAST');
    y += h + 4;
    if (caption) paragraph(caption, { size: 8.5, color: MUTED });
    y += 6;
  };

  // ---- Page 1: summary ----
  doc.setFillColor(...HEAD);
  doc.rect(0, 0, pageW, 92, 'F');
  doc.setTextColor(241, 245, 249);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text(setup.title, MARGIN, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(`${setup.network} · ${analysis.total} simulation runs · ${stamp()}`, MARGIN, 64);
  y = 116;

  heading('Summary');
  paragraph(analysis.verdict, { size: 11, bold: true });
  paragraph(analysis.confidence, { size: 10 });
  for (const f of analysis.findings) paragraph(`•  ${f}`, { size: 9.5, indent: 6 });
  y += 4;

  heading('Key results');
  table(
    ['Measure', 'Fixed cycle', 'Greedy', 'Change with Greedy', '95% range', 'Greedy better in'],
    analysis.metrics.map((m) => {
      const o = analysis.overall[m.key];
      return [m.label, m.format(o.fixed), m.format(o.greedy), pct(o.stats.mean), Number.isFinite(o.stats.low) ? `${pct(o.stats.low)} to ${pct(o.stats.high)}` : '-', `${o.stats.wins} of ${o.stats.n} runs`];
    }),
  );
  paragraph('Change: positive means Greedy did better (less waiting, or more vehicles through). Averages are over all runs.', { size: 8.5, color: MUTED });
  y += 4;

  heading('Setup');
  table(['Setting', 'Value'], setup.rows, { columnStyles: { 0: { cellWidth: 190 } } });

  // ---- Charts ----
  doc.addPage();
  y = MARGIN;
  heading('Results in charts', 15);
  if (analysis.byLevel.length) chart(levelChart(analysis, 'light'), 'Average number of vehicles waiting in the whole network for each traffic level (orange: fixed cycle, green: Greedy). Lower is better.');
  if (analysis.byPattern.length) chart(patternChart(analysis, 'light'), 'How much less waiting Greedy produced for each kind of traffic pattern. Bars above zero: Greedy better.');
  chart(runsChart(analysis, results, 'light'), 'Each dot is one run. Dots below the dashed line are runs where Greedy kept fewer vehicles waiting than the fixed cycle.', 250);
  chart(timeChart(analysis, 'light'), 'Vehicles waiting at each moment of the most demanding scenario run, both policies on the same traffic.');
  if (analysis.byLevel.length && analysis.overall.throughput) chart(throughputChart(analysis, 'light'), 'Vehicles that completed their trip during the run. Higher is better.');
  chart(scenarioChart(analysis, 'light'), 'Every scenario (traffic level and pattern, averaged over its seeds), from where Greedy helps most to least.', Math.min(560, 60 + analysis.ranked.length * 16));
  chart(intersectionChart(analysis, 'light'), 'The intersections where the two policies differ most, average vehicles waiting over all runs.', Math.min(420, 70 + Math.min(12, analysis.intersections.length) * 22));

  // ---- Tables ----
  doc.addPage();
  y = MARGIN;
  heading('Scenarios', 15);
  table(
    ['Scenario', 'Seeds', 'Fixed: waiting', 'Greedy: waiting', 'Change', 'Greedy better', 'Fixed: through', 'Greedy: through'],
    analysis.scenarios.map((s) => [s.label, s.seeds, s.fixed.toFixed(1), s.greedy.toFixed(1), pct(s.improvement), `${s.wins}/${s.seeds}`, Math.round(s.throughputFixed), Math.round(s.throughputGreedy)]),
  );
  if (analysis.intersections.length) {
    heading('Intersections');
    table(
      ['Intersection', 'Name', 'Fixed: waiting', 'Greedy: waiting', 'Change', 'Greedy better in'],
      analysis.intersections.map((i) => [i.id, i.name || '-', i.fixed.toFixed(1), i.greedy.toFixed(1), pct(i.change), `${i.greedyBetterRuns} of ${analysis.total}`]),
    );
  }
  heading('All runs');
  const m = analysis.headline;
  table(
    ['#', 'Level', 'Pattern', 'Turning', 'Seed', 'Fixed: waiting', 'Greedy: waiting', 'Change', 'Fixed: through', 'Greedy: through'],
    results.slice().sort((a, b) => a.index - b.index).map((r) => [
      r.index + 1, labelOf.level(r.level), labelOf.pattern(r.pattern), labelOf.turn(r.turn), r.seed,
      r.fixed[m.key].toFixed(1), r.greedy[m.key].toFixed(1), pct(improvement(r.fixed[m.key], r.greedy[m.key], true)),
      r.fixed.throughput, r.greedy.throughput,
    ]),
    { styles: { fontSize: 7, cellPadding: 2, textColor: INK } },
  );

  heading('How this was measured');
  const notes = [
    'Every run simulates both policies on exactly the same traffic: the same cars arrive at the same steps and make the same turns. Only the signal control differs.',
    `Traffic levels scale the base inflow: ${LEVELS.map((l) => `${l.label} ${l.scale}×`).join(', ')}.`,
    `Traffic patterns: ${PATTERNS.map((p) => `${p.label}, ${p.description}`).join('; ')}. Every pattern has the same average.`,
    'Seeds change the random parts (turn choices and random arrivals); each scenario is repeated with several seeds.',
    'Change with Greedy is worked out run by run: for waiting, (fixed − Greedy) ÷ fixed; for vehicles through, (Greedy − fixed) ÷ fixed. Positive always means Greedy did better.',
    'The 95% range is a Student-t interval over the run-by-run changes: if it lies entirely above zero, the improvement is not down to chance.',
    'All times are in simulation steps and all counts in vehicles, as in the simulator.',
  ];
  for (const n of notes) paragraph(`•  ${n}`, { size: 9, indent: 6 });

  // Page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let k = 1; k <= pages; k++) {
    doc.setPage(k);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`UrbanGrid Simulator · ${setup.title} · page ${k} of ${pages}`, MARGIN, pageH - 18);
  }
  doc.save(`urbangrid-report-${analysis.kind}-${fileStamp()}.pdf`);
}

// Every run as a spreadsheet row.
export function downloadCsv(analysis, results) {
  const metrics = analysis.metrics;
  const head = ['run', 'level', 'pattern', 'turning', 'seed', ...metrics.flatMap((m) => [`fixed_${m.key}`, `greedy_${m.key}`, `change_${m.key}`])];
  const rows = results.slice().sort((a, b) => a.index - b.index).map((r) => [
    r.index + 1, r.level, r.pattern, r.turn, r.seed,
    ...metrics.flatMap((m) => [r.fixed[m.key], r.greedy[m.key], improvement(r.fixed[m.key], r.greedy[m.key], m.lowerIsBetter)]),
  ]);
  const csv = [head, ...rows].map((row) => row.map((v) => (v == null ? '' : typeof v === 'number' ? +v.toFixed(4) : v)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `urbangrid-runs-${analysis.kind}-${fileStamp()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
