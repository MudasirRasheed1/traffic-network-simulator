import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import {
  alignDataEntries, buildDataSeries, buildDataset, dataStepCount, dataTimeline, missingDataMessage, parseSpreadCode, makeDataConfig, parseDelimitedText, parseInterval, parseTime, skewWeights,
} from '../dataInflow.js';
import { SimulationEngine } from '../engine.js';
import { gridEngineConfig } from '../gridEngineConfig.js';
import { useSimStore } from '../../store/useSimStore.js';

const config = (rows, patch = {}) => {
  const dataset = buildDataset(rows, 'test.csv');
  expect(dataset.errors).toEqual([]);
  return { ...makeDataConfig(dataset), ...patch };
};
const sum = (xs) => xs.reduce((s, v) => s + v, 0);

describe('reading times', () => {
  it('reads seconds, clock times and dates', () => {
    expect(parseTime('12.5')).toEqual({ seconds: 12.5, kind: 'number' });
    expect(parseTime('08:00:05').seconds).toBe(8 * 3600 + 5);
    expect(parseTime('8:30 pm').seconds).toBe(20.5 * 3600);
    expect(parseTime('2026-10-26 08:00:10').seconds - parseTime('2026-10-26 08:00:00').seconds).toBe(10);
    expect(parseTime('cars')).toBeNull();
  });

  it('reads periods written in one cell', () => {
    expect(parseInterval('08:00-08:15').map((t) => t.seconds)).toEqual([28800, 29700]);
    expect(parseInterval('08:00 to 08:15').map((t) => t.seconds)).toEqual([28800, 29700]);
    const [a, b] = parseInterval('2026-10-26 08:00 - 2026-10-26 08:15');
    expect(b.seconds - a.seconds).toBe(900);
  });

  it('splits comma, semicolon and tab files, with quotes', () => {
    expect(parseDelimitedText('time;cars\n0;3\n')).toEqual([['time', 'cars'], ['0', '3']]);
    expect(parseDelimitedText('"time","cars"\n"0","1,200"')).toEqual([['time', 'cars'], ['0', '1,200']]);
    expect(parseDelimitedText('time\tcars\n5\t2')).toEqual([['time', 'cars'], ['5', '2']]);
  });
});

describe('case 1: a time and cars', () => {
  it('adds rows in the same step and leaves gaps empty (spec example)', () => {
    const data = config([['time', 'vehicles'], ['08:00:02', '3'], ['08:00:04', '1'], ['08:00:11', '2'], ['08:00:23', '1']]);
    expect(data.kind).toBe('moments');
    expect(buildDataSeries(data)).toEqual([4, 2, 0, 0, 1]);
    expect(dataStepCount(data)).toBe(5);
  });

  it('counts one car per row when there is no cars column', () => {
    const data = config([['timestamp'], ['0'], ['1'], ['7'], ['14']]);
    expect(buildDataSeries(data)).toEqual([2, 1, 1]);
  });

  it('follows clock times over midnight', () => {
    const data = config([['time', 'cars'], ['23:59:50', '1'], ['00:00:05', '1']]);
    expect(buildDataSeries(data)).toEqual([1, 0, 0, 1]);
  });

  it('works without column names', () => {
    const data = config([['0', '2'], ['5', '3']]);
    expect(buildDataSeries(data)).toEqual([2, 3]);
  });

  it('keeps one column per source and picks the one named after the source', () => {
    const dataset = buildDataset([['time', 'G1', 'G2'], ['0', '1', '4'], ['5', '2', '0']], 'f.csv');
    expect(dataset.columns).toEqual(['G1', 'G2']);
    expect(makeDataConfig(dataset, ['G2']).column).toBe('G2');
    expect(buildDataSeries(makeDataConfig(dataset, ['G2']))).toEqual([4, 0]);
  });
});

describe('case 2: a period and cars', () => {
  const rows = [['start', 'end', 'vehicles'], ['0', '30', '12']];

  it('even: the same number in every step', () => {
    const data = config(rows, { spread: 'even' });
    expect(data.kind).toBe('periods');
    expect(buildDataSeries(data)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('random: exact total, the same for the same seed', () => {
    const data = config(rows, { spread: 'random' });
    const a = buildDataSeries(data, seedrandom('s1'));
    expect(sum(a)).toBe(12);
    expect(buildDataSeries(data, seedrandom('s1'))).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(6);
  });

  it('random: every window gets the average rounded down or up, picked at random', () => {
    const data = config([['interval', 'cars'], ['08:10-08:20', '140']], { spread: 'random' });
    const one = buildDataSeries(data, seedrandom('a'));
    const two = buildDataSeries(data, seedrandom('b'));
    expect(one).toHaveLength(120);
    expect(new Set(one)).toEqual(new Set([1, 2]));
    expect(sum(one)).toBe(140);
    expect(one.filter((v) => v === 2)).toHaveLength(20);
    expect(one).not.toEqual(two);
    // Fewer cars than windows: only empty windows and single cars.
    const light = buildDataSeries(config([['interval', 'cars'], ['08:00-08:10', '90']], { spread: 'random' }), seedrandom('c'));
    expect(new Set(light)).toEqual(new Set([0, 1]));
    expect(sum(light)).toBe(90);
  });

  it('skewed: each window gets its share of the shape, rounded down or up', () => {
    // Peak at 20%, medium: exact shares 3.16, 4.63, 2.90, 1.10, 0.20, 0.01.
    const data = config(rows, { spread: 'skewed', skewPeak: 0.2, skewStrength: 'medium' });
    const exact = skewWeights(6, 0.2, 'medium').map((w) => w * 12);
    for (const seed of ['a', 'b', 'c']) {
      const s = buildDataSeries(data, seedrandom(seed));
      expect(sum(s)).toBe(12);
      s.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(Math.floor(exact[k]));
        expect(v).toBeLessThanOrEqual(Math.ceil(exact[k]));
      });
    }
    const w = skewWeights(10, 1, 'strong');
    expect(w.indexOf(Math.max(...w))).toBe(9);
  });

  it('a period without an end lasts until the next one starts', () => {
    const data = config([['interval_start', 'cars'], ['08:00', '6'], ['08:00:30', '3'], ['08:01', '0']].map((r, k) => (k === 0 ? ['start', 'cars'] : r)), { spread: 'even' });
    // 6 cars in 30 s, then 3 cars in 30 s, then a last 30 s period with none.
    const s = buildDataSeries(data, seedrandom('p'));
    expect(s).toHaveLength(18);
    expect(s.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(sum(s.slice(6, 12))).toBe(3);
    expect(new Set(s.slice(6, 12))).toEqual(new Set([0, 1]));
    expect(s.slice(12)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('reads periods from one column', () => {
    const data = config([['interval', 'flow'], ['08:00-08:01', '12'], ['08:01-08:02', '24']], { spread: 'even' });
    expect(buildDataSeries(data)).toEqual([...Array(12).fill(1), ...Array(12).fill(2)]);
  });

  it('scales every count (Extract Details levels)', () => {
    const data = config(rows, { spread: 'even', scale: 0.5 });
    expect(sum(buildDataSeries(data))).toBe(6);
  });
});

describe('problems in a file', () => {
  it('lists unreadable rows by their line number', () => {
    const dataset = buildDataset([['time', 'cars'], ['0', '1'], ['soon', '2'], ['10', '-3']], 'bad.csv');
    expect(dataset.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it('asks for a time column', () => {
    const dataset = buildDataset([['place', 'cars'], ['a', '1']], 'x.csv');
    expect(dataset.errors[0].text).toMatch(/No time column/);
  });

  it('reports data-file sources with no file loaded', () => {
    const data = config([['time', 'cars'], ['0', '1'], ['95', '1']]);
    const loaded = { mode: 'function', functionConfig: { profileType: 'data', data } };
    const empty = { mode: 'function', functionConfig: { profileType: 'data' } };
    expect(missingDataMessage([{ label: 'G1', profile: loaded }])).toBeNull();
    expect(missingDataMessage([{ label: 'G1', profile: loaded }, { label: 'G2', profile: empty }])).toMatch(/No data file loaded for G2/);
  });
});

describe('data files in the grid engine', () => {
  const data = config([['time', 'cars'], ['0', '3'], ['5', '7'], ['10', '2']]);
  const profile = { mode: 'function', constantValue: 0, functionConfig: { profileType: 'data', data } };
  const state = (duration) => {
    const base = useSimStore.getState();
    return {
      ...base,
      config: { ...base.config, gridSize: 2, simDuration: duration, defaultBoundaryInflowProfiles: { N: profile, S: { mode: 'constant', constantValue: 0 }, E: { mode: 'constant', constantValue: 0 }, W: { mode: 'constant', constantValue: 0 } } },
    };
  };

  it('feeds exactly the data, without the per-step cap', () => {
    const engine = new SimulationEngine(gridEngineConfig({ ...state(3), config: { ...state(3).config, inflowGlobalCap: 4 } }));
    engine.init();
    expect(engine.arrivalRateSeriesByKey['0,0,N']).toEqual([3, 7, 2]);
  });

  it('runs longer than the data, with no cars after it ends', () => {
    const engine = new SimulationEngine(gridEngineConfig(state(6)));
    engine.init();
    expect(engine.arrivalRateSeriesByKey['0,0,N']).toEqual([3, 7, 2, 0, 0, 0]);
  });
});

const profileOf = (rows, patch = {}) => ({ mode: 'function', constantValue: 0, functionConfig: { profileType: 'data', data: config(rows, patch) } });
const seriesOf = (entry) => buildDataSeries(entry.profile.functionConfig.data);

describe('one clock for every source', () => {
  it('starts every source at the earliest time in any file', () => {
    const early = profileOf([['time', 'cars'], ['08:00:00', '2'], ['08:00:05', '1']]);
    const late = profileOf([['time', 'cars'], ['08:01:00', '4']]);
    const { entries, timeline } = alignDataEntries([{ label: 'G1', profile: early }, { label: 'G2', profile: late }], { stepSeconds: 5 });
    expect(timeline.earliestLabel).toBe('G1');
    expect(seriesOf(entries[0])).toEqual([2, 1]);
    expect(seriesOf(entries[1])).toEqual([...Array(12).fill(0), 4]);
  });

  it('can start later than the data; cars before the start are dropped', () => {
    const p = profileOf([['time', 'cars'], ['08:00:00', '2'], ['08:00:12', '3']]);
    const { entries } = alignDataEntries([{ label: 'G1', profile: p }], { stepSeconds: 5, start: '08:00:10' });
    expect(seriesOf(entries[0])).toEqual([3]);
  });

  it('refuses files with different time formats', () => {
    const clock = profileOf([['time', 'cars'], ['08:00', '1']]);
    const secs = profileOf([['time', 'cars'], ['0', '1']]);
    expect(dataTimeline([{ label: 'A', profile: clock }, { label: 'B', profile: secs }]).error).toMatch(/different time formats/);
  });

  it('lines up grid entry points in the engine', () => {
    const north = profileOf([['time', 'cars'], ['08:00:00', '1']]);
    const west = profileOf([['time', 'cars'], ['08:00:10', '5']]);
    const base = useSimStore.getState();
    const engine = new SimulationEngine(gridEngineConfig({
      ...base,
      config: { ...base.config, gridSize: 2, simDuration: 4, defaultBoundaryInflowProfiles: { N: north, W: west, S: { mode: 'constant', constantValue: 0 }, E: { mode: 'constant', constantValue: 0 } } },
    }));
    engine.init();
    expect(engine.arrivalRateSeriesByKey['0,0,N']).toEqual([1, 0, 0, 0]);
    expect(engine.arrivalRateSeriesByKey['0,0,W']).toEqual([0, 0, 5, 0]);
  });
});

describe('periods on the windows of the shared clock', () => {
  it('keeps only the part of a period inside the run (the 6-car example)', () => {
    const p = profileOf([['start', 'end', 'cars'], ['07:59:50', '08:00:20', '6']], { spread: 'even' });
    const { entries } = alignDataEntries([{ label: 'G1', profile: p }], { stepSeconds: 5, start: '08:00' });
    expect(seriesOf(entries[0])).toEqual([1, 1, 1, 1]);
  });

  it('shares a window between two periods by time', () => {
    // 0 to 7.5 s: 3 cars; 7.5 to 15 s: 3 cars; windows of 5 s.
    const data = config([['start', 'end', 'cars'], ['0', '7.5', '3'], ['7.5', '15', '3']], { spread: 'even' });
    expect(buildDataSeries(data)).toEqual([2, 2, 2]);
  });
});

describe('spread codes per row', () => {
  it('reads the codes', () => {
    expect(parseSpreadCode('equal')).toEqual({ type: 'even' });
    expect(parseSpreadCode('Left High')).toEqual({ type: 'skewed', peak: 0, strength: 'strong' });
    expect(parseSpreadCode('right-low')).toEqual({ type: 'skewed', peak: 1, strength: 'mild' });
    // Older codes still read.
    expect(parseSpreadCode('random')).toEqual({ type: 'even' });
    expect(parseSpreadCode('center-medium-random')).toEqual({ type: 'skewed', peak: 0.5, strength: 'medium' });
    expect(parseSpreadCode('peak-30-low')).toEqual({ type: 'skewed', peak: 0.3, strength: 'mild' });
    expect(parseSpreadCode('sideways')).toBeNull();
  });

  it('each row uses its own code, empty cells the panel choice', () => {
    const data = config([['start', 'end', 'cars', 'spread'], ['0', '30', '12', 'left-high'], ['30', '60', '12', ''], ['60', '90', '12', 'right-high']], { spread: 'even' });
    const s = buildDataSeries(data);
    expect(s.slice(0, 6)[0]).toBeGreaterThan(s[5]);
    expect(s.slice(6, 12)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(s[17]).toBeGreaterThan(s[12]);
    expect(sum(s)).toBe(36);
  });

  it('a right skew keeps the total and puts most cars in the last windows', () => {
    const data = config([['start', 'end', 'cars', 'spread'], ['0', '100', '400', 'right-high']]);
    const s = buildDataSeries(data, seedrandom('k'));
    expect(sum(s)).toBe(400);
    expect(sum(s.slice(10))).toBeGreaterThan(sum(s.slice(0, 10)));
  });

  it('flags unknown codes by row', () => {
    const dataset = buildDataset([['start', 'end', 'cars', 'spread'], ['0', '30', '1', 'sideways']], 'x.csv');
    expect(dataset.errors[0]).toMatchObject({ row: 2 });
  });
});
