const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { METRICS, parseTimestamp, parseCsv, classifyQuality, applyFlatQuality, weightedStats, aggregateSeries, analyzeRows, evaluateAlerts } = require('../lib/engine');

const HEADER = 'timestamp,dht_temp_C,dht_humi_pct,am_temp_C,am_humi_pct,co2_ppm,voc_level,pm25_ugm3';
function row(time, value, quality = 'valid') {
  return { measured_at: new Date(time).toISOString(), metrics: { pm25_ugm3: value }, quality: { pm25_ugm3: { quality, quality_reasons: [] } } };
}
const EPOCH = Date.parse('2026-10-03T00:00:00Z');

test('CSV recognizes BOM, CRLF, quoted fields, Korean local time and missing channels', () => {
  const parsed = parseCsv(`\uFEFF${HEADER}\r\n"2026-10-03 00:29:31",20.4,33,0,99,813,0,7\r\n2026-10-03 00:29:32,20.4,33,,,,,\r\n`);
  assert.equal(parsed.total_rows, 2);
  assert.equal(parsed.invalid, 0);
  assert.equal(parsed.preview.length, 2);
  assert.equal(parsed.rows[0].measured_at, '2026-10-02T15:29:31.000Z');
  for (const metric of ['am_temp_C', 'am_humi_pct', 'co2_ppm', 'voc_level', 'pm25_ugm3']) {
    assert.equal(parsed.rows[1].metrics[metric], null, metric);
    assert.equal(parsed.rows[1].quality[metric].quality, 'missing', metric);
    assert.equal(parsed.missing_by_metric[metric], 1, metric);
  }
  assert.equal(parsed.rows[0].metrics.am_temp_C, 0, 'a measured zero is preserved');
});

test('timestamp validation rejects impossible dates and live timestamps without zones', () => {
  assert.equal(parseTimestamp('2026-02-30 11:00:00'), null);
  assert.equal(parseTimestamp('2026-10-03T00:29:31', 'Asia/Seoul', true), null);
  assert.equal(parseTimestamp('2026-10-03T00:29:31+09:00', 'Asia/Seoul', true), '2026-10-02T15:29:31.000Z');
  assert.equal(parseTimestamp('2026-10-03 00:29:31', 'UTC'), '2026-10-03T00:29:31.000Z');
});

test('CSV quarantines bad timestamps but distinguishes nonnumeric and empty values', () => {
  const parsed = parseCsv('timestamp,pm25_ugm3\n2026-10-03 00:00:00,broken\n2026-10-03 00:00:01,\nbad timestamp,5\n');
  assert.equal(parsed.total_rows, 3);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.invalid, 1);
  assert.equal(parsed.rows[0].metrics.pm25_ugm3, null);
  assert.equal(parsed.rows[0].quality.pm25_ugm3.quality, 'invalid');
  assert.equal(parsed.rows[1].quality.pm25_ugm3.quality, 'missing');
  assert.throws(() => parseCsv('timestamp,pm25_ugm3,pm25_ugm3\n2026-10-03 00:00:00,1,2'), /중복/);
});

test('quality preserves high PM values while rejecting negative concentrations and impossible humidity', () => {
  assert.equal(classifyQuality('pm25_ugm3', 856).quality, 'unknown');
  assert.equal(classifyQuality('pm25_ugm3', -1).quality, 'invalid');
  assert.equal(classifyQuality('co2_ppm', -20).quality, 'invalid');
  assert.equal(classifyQuality('dht_humi_pct', 101).quality, 'invalid');
  assert.equal(classifyQuality('pm25_ugm3', 10, { verified: true, readStatus: 'ok' }).quality, 'valid');
  assert.equal(classifyQuality('pm25_ugm3', 10, { verified: true, readStatus: 'error' }).quality, 'missing');
});

test('averages are time weighted, bounded at three seconds, and exclude suspect readings', () => {
  const rows = [row(EPOCH, 10), row(EPOCH + 1000, 20), row(EPOCH + 3000, 100, 'suspect'), row(EPOCH + 20000, 30)];
  const initial = weightedStats(rows, 'pm25_ugm3', EPOCH, EPOCH + 3000);
  assert.ok(Math.abs(initial.mean - 50 / 3) < 1e-10);
  assert.equal(initial.coverage, 1);
  const stats = weightedStats(rows, 'pm25_ugm3', EPOCH, EPOCH + 21000);
  assert.equal(stats.mean, 20);
  assert.equal(stats.coverage, 4 / 21);
  assert.equal(stats.max, 30);
  const unknown = weightedStats([row(EPOCH, 100, 'unknown')], 'pm25_ugm3', EPOCH, EPOCH + 1000, { validOnly: true });
  assert.equal(unknown.mean, null);
  assert.equal(unknown.coverage, 0);
});

test('long chart gaps yield null buckets and chart results remain bounded', () => {
  const rows = [row(EPOCH, 856), row(EPOCH + 261828000, 5)];
  const series = aggregateSeries(rows, 'pm25_ugm3', new Date(EPOCH).toISOString(), new Date(EPOCH + 261829000).toISOString(), '5s');
  assert.ok(series.points.length <= 1500);
  assert.equal(series.points[0].max, 856);
  assert.equal(series.points[Math.floor(series.points.length / 2)].mean, null);
  assert.equal(series.points[Math.floor(series.points.length / 2)].coverage, 0);
});

test('VOC is categorical with step duration and cannot invent fractional levels', () => {
  const rows = [
    { measured_at: new Date(EPOCH).toISOString(), metrics: { voc_level: 0 }, quality: { voc_level: { quality: 'valid' } } },
    { measured_at: new Date(EPOCH + 1000).toISOString(), metrics: { voc_level: 3 }, quality: { voc_level: { quality: 'valid' } } },
    { measured_at: new Date(EPOCH + 3000).toISOString(), metrics: { voc_level: 1 }, quality: { voc_level: { quality: 'valid' } } },
  ];
  const stats = weightedStats(rows, 'voc_level', EPOCH, EPOCH + 4000);
  assert.equal(stats.mean, null);
  assert.deepEqual(stats.category_durations_seconds, { 0: 1, 3: 2, 1: 1 });
  assert.equal(stats.changes, 2);
  assert.equal(stats.current, 1);
  const series = aggregateSeries(rows, 'voc_level', new Date(EPOCH).toISOString(), new Date(EPOCH + 5000).toISOString(), '5s');
  assert.equal(series.points[0].mean, null);
  assert.equal(series.points[0].category, 1);
  assert.deepEqual(series.points[0].category_durations_seconds, { 0: 1, 3: 2, 1: 1 });
});

test('sustained valid readings trigger alerts but unknown quality and gaps do not', () => {
  const rule = { id: 'test-pm', metric: 'pm25_ugm3', severity: 'warning', operator: '>', threshold: 35, clear_threshold: 30, hold_seconds: 20, window_seconds: 10, clear_hold_seconds: 20, enabled: true, version: 1 };
  const sustained = Array.from({ length: 61 }, (_, i) => row(EPOCH + i * 1000, 80));
  const events = evaluateAlerts(sustained, [rule], { source: 'live', deviceId: 'lab-01' });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'active');
  assert.equal(events[0].device_id, 'lab-01');
  assert.equal(evaluateAlerts(sustained.map(r => row(Date.parse(r.measured_at), 80, 'unknown')), [rule]).length, 0);
  assert.equal(evaluateAlerts([row(EPOCH, 80), row(EPOCH + 61000, 80)], [rule]).length, 0);
  const historical = evaluateAlerts(sustained, [rule], { source: 'historical' });
  assert.equal(historical[0].status, 'historical');
});

test('active alerts survive collection interruptions and resolve only after low readings persist', () => {
  const rule = { id: 'test-pm', metric: 'pm25_ugm3', severity: 'warning', operator: '>', threshold: 35, clear_threshold: 30, hold_seconds: 20, window_seconds: 10, clear_hold_seconds: 20, enabled: true, version: 1 };
  const rows = Array.from({ length: 41 }, (_, i) => row(EPOCH + i * 1000, 80));
  rows.push(row(EPOCH + 180000, null, 'missing'));
  assert.equal(evaluateAlerts(rows, [rule], { source: 'live' })[0].status, 'active');
  for (let i = 181; i <= 240; i++) rows.push(row(EPOCH + i * 1000, 10));
  const events = evaluateAlerts(rows, [rule], { source: 'live' });
  assert.equal(events[0].status, 'resolved');
  assert.ok(events[0].ended_at);
});

const originalCsv = '/Users/been/Downloads/수요일 PBL/CSV 파이썬 코드/air_log.csv';
test('original Arduino log retains exact count, nulls, long gap, maximum and fixed-channel evidence', { skip: !fs.existsSync(originalCsv) }, () => {
  const parsed = parseCsv(fs.readFileSync(originalCsv, 'utf8'));
  assert.equal(parsed.total_rows, 124251);
  assert.equal(parsed.rows.length, 124251);
  assert.equal(parsed.invalid, 0);
  for (const metric of ['am_temp_C', 'am_humi_pct', 'co2_ppm', 'voc_level', 'pm25_ugm3']) assert.equal(parsed.missing_by_metric[metric], 8, metric);
  assert.equal(parsed.rows[0].measured_at, '2026-10-02T15:29:31.000Z');
  assert.equal(parsed.rows.at(-1).measured_at, '2026-10-07T05:05:46.000Z');
  applyFlatQuality(parsed.rows);
  const analyzed = analyzeRows(parsed.rows, parsed.rows.at(-1).measured_at);
  assert.equal(analyzed.summary.longest_gap_seconds, 261828);
  assert.equal(analyzed.metrics.pm25_ugm3.max, 856);
  assert.ok(analyzed.summary.flat_channels.includes('co2_ppm'));
  assert.ok(analyzed.summary.flat_channels.includes('am_temp_C'));
  assert.ok(analyzed.summary.flat_channels.includes('am_humi_pct'));
  assert.equal(analyzed.metrics.voc_level.unit, '단계');
  assert.equal(METRICS.length, 7);
});
