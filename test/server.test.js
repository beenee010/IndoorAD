const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const HEADER = 'timestamp,dht_temp_C,dht_humi_pct,am_temp_C,am_humi_pct,co2_ppm,voc_level,pm25_ugm3';
const CSV = `${HEADER}\r\n2026-10-03 00:29:31,20.4,33,0,99,813,0,7\r\n2026-10-03 00:29:32,20.4,33,,,,,\r\n2026-10-03 00:29:34,20.5,34,0,99,813,1,856\r\n2026-10-04 13:21:28,21,35,0,99,813,3,15\r\n2026-10-07 14:05:16,22,50,22,50,900,2,5\r\n`;

async function withApp(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'airguard-test-'));
  const { createApp } = require('../server');
  const app = createApp({ dbPath: path.join(directory, 'test.sqlite'), deviceToken: 'test-device-token', ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ...app, base, directory };
}

async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, options);
  const body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : await response.text();
  return { response, body };
}

function json(body, authorized = false) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-device-token' } : {}) }, body: JSON.stringify(body) };
}

test('only dashboard assets are public and implementation files remain private', async t => {
  const { base } = await withApp(t);
  for (const route of ['/', '/styles.css', '/script.js']) {
    const { response } = await request(base, route);
    assert.equal(response.status, 200, route);
  }
  for (const route of ['/server.js', '/.env', '/.env.example', '/package.json', '/lib/store.js', '/data/airguard.sqlite', '/docs/build_dashboard_design.py']) {
    const { response } = await request(base, route);
    assert.equal(response.status, 404, route);
  }
});

test('live ingestion requires the device token', async t => {
  const { base } = await withApp(t);
  const { response } = await request(base, '/api/v1/measurements/batch', json({ schema_version: '1.0', device_id: 'lab-01', batch_id: 'test-unauthorized', samples: [] }));
  assert.equal(response.status, 401);
});

test('reviewed rule edits record before and after, reject stale writes and retain an append-only chain', async t => {
  const { base, store } = await withApp(t);
  const revisionPath = '/api/v1/alert-rule-revisions';
  const rulePath = '/api/v1/alert-rules/pm25-warning';
  const update = body => request(base, rulePath, { ...json(body), method: 'PUT' });
  assert.deepEqual((await request(base, revisionPath)).body, { integrity: 'empty', entries: [], total: 0 });

  const original = store.rule('pm25-warning');
  const { version, threshold } = original;
  const expected = { expected_version: version, reason: '  교실 운영 기준 검토  ' };
  const missingReason = await update({ threshold: threshold + 5, expected_version: version });
  assert.equal(missingReason.response.status, 400);
  const first = await update({ ...expected, threshold: threshold + 5 });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.version, version + 1);

  const stale = await update({ ...expected, threshold: threshold + 10 });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error_code, 'RULE_VERSION_CONFLICT');
  const current = { ...expected, expected_version: first.body.version };
  const noOp = await update({ ...current, threshold: first.body.threshold });
  assert.equal(noOp.body.version, first.body.version);
  const second = await update({ ...current, threshold: threshold + 10 });
  assert.equal(second.response.status, 200);

  const { integrity, entries, total } = (await request(base, revisionPath)).body;
  assert.equal(integrity, 'verified');
  assert.equal(total, 2);
  assert.equal(entries[0].previous_hash, entries[1].entry_hash);
  assert.deepEqual(entries[1].before, original);
  assert.deepEqual(entries[1].after, first.body);
  assert.deepEqual(entries[0].before, first.body);
  assert.deepEqual(entries[0].after, second.body);
  assert.equal(entries[1].reason, '교실 운영 기준 검토');
  assert.throws(() => store.db.exec("UPDATE rule_revisions SET payload='{}' WHERE seq=1"), /append-only/);
  assert.throws(() => store.db.exec('DELETE FROM rule_revisions WHERE seq=2'), /append-only/);

  store.db.prepare('UPDATE rules SET data=? WHERE id=?').run(JSON.stringify(first.body), 'pm25-warning');
  assert.equal((await request(base, revisionPath)).body.integrity, 'mismatch');
  const inconsistent = await update({ ...current, threshold: threshold + 15 });
  assert.equal(inconsistent.response.status, 409);
  assert.equal(inconsistent.body.error_code, 'RULE_INTEGRITY_MISMATCH');
});

async function validate(base, csv = CSV, settings = {}) {
  const { response, body } = await request(base, '/api/v1/imports/validate', json({ device_id: 'lab-01', csv, filename: 'arduino.csv', timezone: 'Asia/Seoul', ...settings }));
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
async function commit(base, validation_token) {
  const result = await request(base, '/api/v1/imports/commit', json({ validation_token }));
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body;
}

test('CSV validates all rows and stores nulls with accurate Korean timestamps', async t => {
  const { base } = await withApp(t);
  const devices = await request(base, '/api/v1/devices');
  assert.equal(devices.body.devices[0].id, 'lab-01');
  assert.equal(devices.body.devices[0].count, 0);
  const report = await validate(base);
  assert.equal(report.rows, 5);
  assert.equal(report.valid_rows, 5);
  assert.equal(report.preview.length, 5);
  assert.equal(report.start, '2026-10-02T15:29:31.000Z');
  assert.equal(report.end, '2026-10-07T05:05:16.000Z');
  assert.equal(report.preview[1].pm25_ugm3, null);
  assert.equal(report.missing_by_metric.pm25_ugm3, 1);
  const saved = await commit(base, report.validation_token);
  assert.equal(saved.accepted, 5);
  const { body: dashboard } = await request(base, '/api/v1/dashboard?device_id=lab-01&mode=historical&from=2026-10-02T00:00:00Z&to=2026-10-08T00:00:00Z');
  assert.equal(dashboard.summary.rows, 5);
  assert.equal(dashboard.summary.longest_gap_seconds, 261828);
  assert.equal(dashboard.metrics.pm25_ugm3.max, 856);
  assert.equal(dashboard.metrics.voc_level.unit, '단계');
  assert.equal(dashboard.metrics.pm25_ugm3.mean_60s, null, 'unknown sensor quality cannot imply a valid mean');
  const raw = await request(base, '/api/v1/measurements?device_id=lab-01&from=2026-10-02T00:00:00Z&to=2026-10-08T00:00:00Z');
  assert.equal(raw.body.rows[1].metrics.co2_ppm, null);
  assert.equal(raw.body.rows[1].quality.pm25_ugm3.quality, 'missing');
  const { body: series } = await request(base, '/api/v1/series?device_id=lab-01&metric=pm25_ugm3&from=2026-10-04T04:21:28Z&to=2026-10-07T05:05:17Z&interval=5s');
  assert.ok(series.points.length <= 1500);
  assert.equal(series.points[Math.floor(series.points.length / 2)].mean, null);
  const live = await request(base, '/api/v1/alerts?device_id=lab-01&mode=live');
  assert.deepEqual(live.body.alerts, [], 'CSV cannot emit active live alerts');
});

test('re-import is idempotent, conflicting values cannot overwrite data and validation tokens are single use', async t => {
  const { base } = await withApp(t);
  const first = await validate(base);
  await commit(base, first.validation_token);
  const consumed = await request(base, '/api/v1/imports/commit', json({ validation_token: first.validation_token }));
  assert.equal(consumed.response.status, 400);
  const second = await validate(base);
  assert.equal(second.duplicates, 5);
  assert.equal(second.conflicts, 0);
  const duplicate = await commit(base, second.validation_token);
  assert.equal(duplicate.accepted, 0);
  assert.equal(duplicate.duplicates, 5);
  const altered = await validate(base, CSV.replace(',813,1,856', ',813,1,3'));
  assert.equal(altered.conflicts, 1);
  const conflict = await commit(base, altered.validation_token);
  assert.equal(conflict.accepted, 0);
  assert.equal(conflict.conflicts, 1);
  const { body } = await request(base, '/api/v1/dashboard?from=2026-10-02T00:00:00Z&to=2026-10-08T00:00:00Z');
  assert.equal(body.summary.rows, 5);
  assert.equal(body.metrics.pm25_ugm3.max, 856);
});

test('live batches accept valid rows, reject future times, preserve bad-channel quality and reuse identical batch IDs', async t => {
  const now = new Date('2026-10-14T00:00:00Z');
  const { base } = await withApp(t, { now: () => now });
  const payload = { schema_version: '1.0', device_id: 'lab-01', batch_id: 'batch-1', samples: [
    { measured_at: '2026-10-14T00:00:00Z', metrics: { pm25_ugm3: -1, co2_ppm: null, dht_humi_pct: 101, voc_level: 3 }, read_status: { air: 'ok', dht: 'ok' } },
    { measured_at: '2026-10-14T00:00:01Z', metrics: { pm25_ugm3: 856, co2_ppm: 900 } },
    { measured_at: '2026-10-14T00:01:00Z', metrics: { pm25_ugm3: 5 } },
    { measured_at: '2026-10-14T00:00:02', metrics: { pm25_ugm3: 5 } },
  ] };
  const first = await request(base, '/api/v1/measurements/batch', json(payload, true));
  assert.equal(first.response.status, 200);
  assert.equal(first.body.accepted, 2);
  assert.equal(first.body.invalid, 2);
  assert.equal(first.body.errors.length, 2);
  const retry = await request(base, '/api/v1/measurements/batch', json(payload, true));
  assert.equal(retry.response.status, 200);
  assert.deepEqual(retry.body, first.body);
  const changed = structuredClone(payload); changed.samples[0].metrics.pm25_ugm3 = 20;
  assert.equal((await request(base, '/api/v1/measurements/batch', json(changed, true))).response.status, 409);
  const raw = await request(base, '/api/v1/measurements?from=2026-10-14T00:00:00Z&to=2026-10-14T00:01:00Z');
  assert.equal(raw.body.total, 2);
  assert.equal(raw.body.rows[0].metrics.pm25_ugm3, -1);
  assert.equal(raw.body.rows[0].quality.pm25_ugm3.quality, 'invalid');
  assert.equal(raw.body.rows[0].metrics.co2_ppm, null);
  assert.equal(raw.body.rows[0].quality.co2_ppm.quality, 'missing');
  assert.equal(raw.body.rows[1].metrics.pm25_ugm3, 856);
});

test('validated import stores the validated file and device despite extra commit fields', async t => {
  const { base } = await withApp(t);
  const report = await validate(base);
  const result = await request(base, '/api/v1/imports/commit', json({ validation_token: report.validation_token, csv: 'timestamp,pm25_ugm3\n2026-10-14 09:00:00,999', device_id: 'other-device', timezone: 'UTC' }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.accepted, 5);
  const { body } = await request(base, '/api/v1/devices');
  assert.equal(body.devices[0].count, 5);
  const wrongToken = await request(base, '/api/v1/imports/commit', json({ validation_token: 'not-a-issued-token' }));
  assert.equal(wrongToken.response.status, 400);
});

test('invalid modes, series parameters and reversed periods return useful 400 errors', async t => {
  const { base } = await withApp(t);
  for (const query of ['/api/v1/dashboard?mode=demo', '/api/v1/series?metric=pm10', '/api/v1/series?interval=bad', '/api/v1/series?from=2026-10-14T00:00:00Z&to=2026-10-13T00:00:00Z', '/api/v1/series?from=oops']) {
    const { response, body } = await request(base, query);
    assert.equal(response.status, 400, query);
    assert.ok(body.error_code, query);
    assert.ok(body.message, query);
    assert.ok(body.request_id, query);
  }
});

test('unknown outdoor configuration never substitutes indoor missing data', async t => {
  const { base } = await withApp(t, { airkoreaKey: '' });
  const { body: outdoor } = await request(base, '/api/v1/outdoor');
  assert.equal(outdoor.configured, false);
  assert.equal(outdoor.observation, null);
  const { body: dashboard } = await request(base, '/api/v1/dashboard');
  assert.equal(dashboard.metrics.pm25_ugm3.latest, null);
  assert.equal(dashboard.metrics.co2_ppm.latest, null);
  assert.equal(dashboard.overall_status, 'undetermined');
});

test('live warning acknowledgement, stale data and true recovery remain distinct through API', async t => {
  const epoch = Date.parse('2026-10-14T00:00:00Z');
  let current = epoch;
  const { base } = await withApp(t, { now: () => new Date(current) });
  const patch = { ...json({ sensor_verified: true, buzzer_supported: true }), method: 'PATCH' };
  assert.equal((await request(base, '/api/v1/devices/lab-01', patch)).response.status, 200);
  const rule = { ...json({ threshold: 35, clear_threshold: 30, window_seconds: 10, hold_seconds: 20, clear_hold_seconds: 20 }), method: 'PUT' };
  assert.equal((await request(base, '/api/v1/alert-rules/pm25-warning', rule)).response.status, 200);
  assert.equal((await request(base, '/api/v1/alert-rules/pm25-critical', { ...json({ enabled: false }), method: 'PUT' })).response.status, 200);
  const samples = (first, last, value) => Array.from({ length: last - first + 1 }, (_, i) => ({ measured_at: new Date(epoch + (first + i) * 1000).toISOString(), metrics: { pm25_ugm3: value }, read_status: { air: 'ok' } }));
  const ingest = (batch_id, rows) => request(base, '/api/v1/measurements/batch', json({ schema_version: '1.0', device_id: 'lab-01', batch_id, samples: rows }, true));
  current = epoch + 30000;
  assert.equal((await ingest('high', samples(0, 30, 80))).response.status, 200);
  current = epoch + 40000;
  assert.equal((await ingest('continued-high', samples(31, 40, 80))).response.status, 200);
  let events = await request(base, '/api/v1/alerts?mode=live');
  assert.equal(events.body.alerts.length, 1);
  const eventId = events.body.alerts[0].id;
  assert.equal(events.body.alerts[0].status, 'active');
  const commandsRoute = '/api/v1/devices/lab-01/commands';
  const tokenHeaders = { Authorization: 'Bearer test-device-token' };
  assert.equal((await request(base, commandsRoute)).response.status, 401);
  const queued = await request(base, commandsRoute, { headers: tokenHeaders });
  assert.equal(queued.response.status, 200);
  assert.equal(queued.body.commands.length, 1);
  const command = queued.body.commands[0];
  assert.equal(command.device_id, 'lab-01');
  assert.equal(command.alert_id, eventId);
  assert.equal(command.type, 'buzzer');
  assert.equal(command.pattern, 'warning');
  assert.equal(command.status, 'pending');
  assert.ok(Date.parse(command.expires_at) > current);
  assert.equal((await request(base, `/api/v1/commands/${command.id}/ack`, json({ status: 'executed' }))).response.status, 401);
  const executed = await request(base, `/api/v1/commands/${command.id}/ack`, json({ status: 'executed' }, true));
  assert.equal(executed.response.status, 200);
  assert.equal(executed.body.status, 'executed');
  const retryExecution = await request(base, `/api/v1/commands/${command.id}/ack`, json({ status: 'executed' }, true));
  assert.equal(retryExecution.response.status, 200);
  assert.deepEqual(retryExecution.body, executed.body);
  assert.deepEqual((await request(base, commandsRoute, { headers: tokenHeaders })).body.commands, []);
  const ack = await request(base, `/api/v1/alerts/${encodeURIComponent(eventId)}/ack`, { method: 'POST' });
  assert.equal(ack.response.status, 200);
  assert.equal(ack.body.status, 'acknowledged');
  assert.equal(ack.body.ended_at, null);
  current = epoch + 50000;
  assert.equal((await ingest('still-high', samples(41, 50, 100))).response.status, 200);
  events = await request(base, '/api/v1/alerts?mode=live');
  assert.equal(events.body.alerts[0].status, 'acknowledged');
  assert.equal(events.body.alerts[0].ended_at, null);
  assert.deepEqual((await request(base, commandsRoute, { headers: tokenHeaders })).body.commands, [], 'same live event must not enqueue a new buzzer command');
  current = epoch + 120000;
  const stale = await request(base, '/api/v1/dashboard?mode=live');
  assert.equal(stale.body.metrics.pm25_ugm3.quality, 'stale');
  events = await request(base, '/api/v1/alerts?mode=live');
  assert.equal(events.body.alerts[0].status, 'acknowledged', 'collection interruption is not recovery');
  current = epoch + 151000;
  assert.equal((await ingest('low-after-gap', samples(121, 151, 10))).response.status, 200);
  current = epoch + 161000;
  assert.equal((await ingest('continued-low', samples(152, 161, 10))).response.status, 200);
  events = await request(base, '/api/v1/alerts?mode=live');
  assert.equal(events.body.alerts.length, 1);
  assert.equal(events.body.alerts[0].status, 'resolved');
  assert.ok(events.body.alerts[0].acknowledged_at);
  assert.ok(events.body.alerts[0].ended_at);
});

test('recent CSV import is never represented as a live sensor stream', async t => {
  const { base } = await withApp(t, { now: () => new Date('2026-10-14T00:00:10Z') });
  assert.equal((await request(base, '/api/v1/devices/lab-01', { ...json({ buzzer_supported: true }), method: 'PATCH' })).response.status, 200);
  const report = await validate(base, 'timestamp,pm25_ugm3\n2026-10-14 09:00:09,856\n');
  await commit(base, report.validation_token);
  const historical = await request(base, '/api/v1/dashboard?mode=historical');
  assert.equal(historical.body.metrics.pm25_ugm3.latest, 856);
  const live = await request(base, '/api/v1/dashboard?mode=live');
  assert.equal(live.body.metrics.pm25_ugm3.latest, null);
  assert.equal(live.body.overall_status, 'undetermined');
  const commands = await request(base, '/api/v1/devices/lab-01/commands', { headers: { Authorization: 'Bearer test-device-token' } });
  assert.equal(commands.response.status, 200);
  assert.deepEqual(commands.body.commands, [], 'CSV imports never issue physical buzzer commands');
});

test('buzzer commands require opt-in and expired commands are excluded from polling', async t => {
  for (const supported of [false, true]) {
    await t.test(supported ? 'enabled but expired' : 'unsupported device', async child => {
      const epoch = Date.parse('2026-10-14T00:00:00Z');
      let current = epoch;
      const { base } = await withApp(child, { now: () => new Date(current) });
      const deviceSettings = { sensor_verified: true, ...(supported ? { buzzer_supported: true } : {}) };
      assert.equal((await request(base, '/api/v1/devices/lab-01', { ...json(deviceSettings), method: 'PATCH' })).response.status, 200);
      const settings = { threshold: 35, clear_threshold: 30, window_seconds: 10, hold_seconds: 20, clear_hold_seconds: 20 };
      assert.equal((await request(base, '/api/v1/alert-rules/pm25-warning', { ...json(settings), method: 'PUT' })).response.status, 200);
      assert.equal((await request(base, '/api/v1/alert-rules/pm25-critical', { ...json({ enabled: false }), method: 'PUT' })).response.status, 200);
      for (const second of [10, 20]) {
        current = epoch + second * 1000;
        const samples = Array.from({ length: 10 }, (_, i) => ({ measured_at: new Date(epoch + (second - 9 + i) * 1000).toISOString(), metrics: { pm25_ugm3: 80 }, read_status: { air: 'ok' } }));
        assert.equal((await request(base, '/api/v1/measurements/batch', json({ schema_version: '1.0', device_id: 'lab-01', batch_id: `high-${second}`, samples }, true))).response.status, 200);
      }
      const alerts = await request(base, '/api/v1/alerts?mode=live');
      assert.equal(alerts.body.alerts.length, 1);
      const headers = { Authorization: 'Bearer test-device-token' };
      const pending = await request(base, '/api/v1/devices/lab-01/commands', { headers });
      assert.equal(pending.response.status, 200);
      assert.equal(pending.body.commands.length, supported ? 1 : 0);
      if (supported) {
        assert.equal(Date.parse(pending.body.commands[0].expires_at) - current, 30000);
        current += 31000;
        const expired = await request(base, '/api/v1/devices/lab-01/commands', { headers });
        assert.deepEqual(expired.body.commands, []);
        const lateAck = await request(base, `/api/v1/commands/${pending.body.commands[0].id}/ack`, json({ status: 'executed' }, true));
        assert.equal(lateAck.response.status, 410, 'expired physical commands cannot be acknowledged as newly executed');
      }
      assert.equal((await request(base, '/api/v1/devices', json({ id: 'other-device', name: 'Other sensor' }))).response.status, 201);
      const wrongDevice = await request(base, '/api/v1/devices/other-device/commands', { headers });
      assert.equal(wrongDevice.response.status, 403);
    });
  }
});
