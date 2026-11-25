const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { parseCsv } = require('../lib/engine');

test('SQLite preserves nulls and exact values across restart and never overwrites conflicting measurements', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'airguard-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'measurements.sqlite');
  const rows = parseCsv('timestamp,pm25_ugm3,co2_ppm\n2026-10-03 00:00:00,856,813\n2026-10-03 00:00:01,,\n').rows;
  let store = new Store(filename);
  try {
    assert.deepEqual(store.insertRows('lab-01', rows), { accepted: 2, duplicates: 0, conflicts: 0, invalid: 0 });
    assert.deepEqual(store.insertRows('lab-01', rows), { accepted: 0, duplicates: 2, conflicts: 0, invalid: 0 });
    const changed = parseCsv('timestamp,pm25_ugm3,co2_ppm\n2026-10-03 00:00:00,3,813\n').rows;
    assert.deepEqual(store.insertRows('lab-01', changed), { accepted: 0, duplicates: 0, conflicts: 1, invalid: 0 });
    assert.equal(store.rows('lab-01')[0].metrics.pm25_ugm3, 856);
    assert.equal(store.rows('lab-01')[1].metrics.pm25_ugm3, null);
    store.close();
    store = new Store(filename);
    assert.equal(store.rows('lab-01').length, 2);
    assert.equal(store.rows('lab-01')[1].metrics.co2_ppm, null);
    assert.equal(store.rows('lab-01')[1].quality.co2_ppm.quality, 'missing');
  } finally { store.close(); }
});

test('acknowledging an alert does not resolve it and re-evaluation retains the acknowledgement', t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const event = { id: 'live:lab-01:pm:1', device_id: 'lab-01', source: 'live', status: 'active', acknowledged_at: null, ended_at: null, value: 80 };
  store.saveAlerts([event]);
  const acknowledged = store.acknowledge(event.id, '2026-10-03T00:00:00.000Z');
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.ended_at, null);
  store.saveAlerts([{ ...event, value: 100 }]);
  const rechecked = store.alerts('lab-01')[0];
  assert.equal(rechecked.status, 'acknowledged');
  assert.equal(rechecked.acknowledged_at, '2026-10-03T00:00:00.000Z');
  assert.equal(rechecked.ended_at, null);
  store.saveAlerts([{ ...event, status: 'resolved', ended_at: '2026-10-03T00:05:00.000Z' }]);
  assert.equal(store.alerts('lab-01')[0].status, 'resolved');
  assert.equal(store.alerts('lab-01')[0].acknowledged_at, '2026-10-03T00:00:00.000Z');
});

test('measurement identity uses normalized numbers regardless of CSV formatting or live metadata', t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const original = parseCsv('timestamp,pm25_ugm3,co2_ppm\n2026-10-03 00:00:00,7.0,813\n').rows;
  const formatted = parseCsv('\uFEFFco2_ppm,timestamp,pm25_ugm3\r\n813.0,"2026-10-03 00:00:00", 7 \r\n').rows;
  assert.equal(store.insertRows('lab-01', original).accepted, 1);
  assert.equal(store.insertRows('lab-01', formatted).duplicates, 1);
  const sameLive = { ...original[0], source: 'live', raw: { pm25_ugm3: 7, co2_ppm: 813 }, read_status: { air: 'ok' }, sample_id: 'live-sample-1' };
  assert.equal(store.insertRows('lab-01', [sameLive]).duplicates, 1);
  assert.equal(store.rows('lab-01').length, 1);
  assert.equal(store.rows('lab-01')[0].source, 'csv', 'duplicate source metadata does not overwrite the original provenance');
});

test('buzzer queue persists across restart and issues at most one command for each event severity', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'airguard-command-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'commands.sqlite');
  const now = '2026-10-14T00:00:00.000Z';
  let store = new Store(filename);
  try {
    store.setDevice({ ...store.getDevice('lab-01'), buzzer_supported: true });
    const event = { id: 'live:warning-1', device_id: 'lab-01', source: 'live', status: 'active', severity: 'warning', started_at: now, ended_at: null };
    const warning = store.enqueueBuzzer(event, now);
    assert.ok(warning.id);
    assert.equal(store.enqueueBuzzer({ ...event, value: 100 }, now), null);
    assert.equal(store.enqueueBuzzer({ ...event, id: 'historical-1', source: 'historical' }, now), null);
    store.close();
    store = new Store(filename);
    assert.equal(store.pendingCommands('lab-01', now).length, 1);
    assert.equal(store.pendingCommands('lab-01', now)[0].id, warning.id);
    const failed = store.acknowledgeCommand(warning.id, 'failed', now);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(store.acknowledgeCommand(warning.id, 'executed', now), failed, 'terminal acknowledgement remains idempotent');
    assert.equal(store.enqueueBuzzer(event, now), null, 'acknowledged severity is never re-enqueued after restart');
    const critical = store.enqueueBuzzer({ ...event, severity: 'critical', escalated_at: now }, now);
    assert.ok(critical.id);
    assert.equal(critical.pattern, 'critical');
    assert.equal(store.enqueueBuzzer({ ...event, severity: 'critical' }, now), null);
    assert.equal(store.pendingCommands('lab-01', now).length, 1);
    assert.deepEqual(store.pendingCommands('lab-01', '2026-10-14T00:00:30.000Z'), []);
  } finally { store.close(); }
});
