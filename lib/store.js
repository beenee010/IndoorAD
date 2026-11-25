const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { METRICS, DEFAULT_RULES, classifyQuality, applyFlatQuality } = require('./engine');

const GENESIS_HASH = '0'.repeat(64);
function revisionHash(sequence, previousHash, payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(['airguard.rule-revision/v1', sequence, previousHash, payload]))
    .digest('hex');
}

class Store {
  constructor(dbPath) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath); this.cache = new Map(); this.version = 0;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS measurements(device_id TEXT NOT NULL,measured_at TEXT NOT NULL,received_at TEXT NOT NULL,source TEXT NOT NULL,import_id TEXT,data TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(device_id,measured_at));
      CREATE INDEX IF NOT EXISTS measurements_device_time ON measurements(device_id,measured_at);
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS import_errors(import_id TEXT NOT NULL,row_number INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(import_id,row_number));
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(device_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(device_id,id));
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,alert_id TEXT NOT NULL,severity TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(alert_id,severity));
      CREATE INDEX IF NOT EXISTS commands_device_status ON commands(device_id,status,expires_at);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rule_revisions(
        seq INTEGER PRIMARY KEY,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS rule_revisions_no_update
        BEFORE UPDATE ON rule_revisions BEGIN SELECT RAISE(ABORT, 'Rule revisions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS rule_revisions_no_delete
        BEFORE DELETE ON rule_revisions BEGIN SELECT RAISE(ABORT, 'Rule revisions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS rule_revisions_no_replace
        BEFORE INSERT ON rule_revisions WHEN EXISTS (SELECT 1 FROM rule_revisions WHERE seq = NEW.seq)
        BEGIN SELECT RAISE(ABORT, 'Rule revisions are append-only'); END;`);
    if (!this.db.prepare('SELECT id FROM devices LIMIT 1').get()) this.setDevice({ id: 'lab-01', name: '실험실 공기질 센서', room: 'PBL 실험실', sensor_verified: false, station_name: '종로구', lat: null, lon: null });
    for (const rule of DEFAULT_RULES) this.db.prepare('INSERT OR IGNORE INTO rules VALUES (?,?)').run(rule.id, JSON.stringify(rule));
    this.insert = this.db.prepare('INSERT INTO measurements VALUES (?,?,?,?,?,?,?)');
    this.exists = this.db.prepare('SELECT fingerprint FROM measurements WHERE device_id=? AND measured_at=?');
  }
  invalidate() { this.version++; this.cache.clear(); }
  getDevice(id) { const r = this.db.prepare('SELECT data FROM devices WHERE id=?').get(id); return r ? { buzzer_supported: false, ...JSON.parse(r.data) } : null; }
  setDevice(device) { this.db.prepare('INSERT OR REPLACE INTO devices VALUES (?,?)').run(device.id, JSON.stringify(device)); this.invalidate(); return device; }
  devices() { return this.db.prepare('SELECT data FROM devices ORDER BY id').all().map(r => { const d = { buzzer_supported: false, ...JSON.parse(r.data) }; const summary = this.db.prepare('SELECT COUNT(*) AS count,MIN(measured_at) AS first_measured_at,MAX(measured_at) AS last_measured_at,MAX(received_at) AS last_received_at FROM measurements WHERE device_id=?').get(d.id); return { ...d, ...summary }; }); }
  fingerprint(row) { return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(METRICS.map(m => [m, row.metrics[m] ?? null])))).digest('hex'); }
  checkRows(deviceId, rows) {
    const seen = new Map(); let duplicates = 0, conflicts = 0;
    for (const row of rows) { const key = row.measured_at, fp = this.fingerprint(row), existing = seen.get(key) || this.exists.get(deviceId, key)?.fingerprint; if (existing) { if (existing === fp) duplicates++; else conflicts++; } else seen.set(key, fp); }
    return { duplicates, conflicts, accepted: rows.length - duplicates - conflicts };
  }
  insertRows(deviceId, rows, { importId = null, now = new Date().toISOString(), invalid = 0 } = {}) {
    let accepted = 0, duplicates = 0, conflicts = 0;
    this.db.exec('BEGIN');
    try {
      for (const row of rows) {
        const fp = this.fingerprint(row), existing = this.exists.get(deviceId, row.measured_at);
        if (existing) { if (existing.fingerprint === fp) duplicates++; else conflicts++; continue; }
        const saved = { ...row, device_id: deviceId, received_at: now, import_id: importId };
        this.insert.run(deviceId, row.measured_at, now, row.source, importId, JSON.stringify(saved), fp); accepted++;
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    if (accepted) this.invalidate();
    return { accepted, duplicates, conflicts, invalid };
  }
  rows(deviceId) {
    if (this.cache.has(deviceId)) return this.cache.get(deviceId);
    const device = this.getDevice(deviceId), rows = this.db.prepare('SELECT data FROM measurements WHERE device_id=? ORDER BY measured_at').all(deviceId).map(r => JSON.parse(r.data));
    for (const row of rows) {
      for (const metric of METRICS) {
        const group = metric.startsWith('dht') ? 'dht' : metric.startsWith('am_') ? 'am' : 'air';
        const explicit = row.read_status?.[metric] || row.read_status?.[group];
        row.quality[metric] = classifyQuality(metric, row.metrics[metric], { verified: Boolean(device?.sensor_verified), readStatus: explicit, invalid: row.quality?.[metric]?.quality === 'invalid' });
      }
    }
    applyFlatQuality(rows); this.cache.set(deviceId, rows); return rows;
  }
  imports(deviceId) { return this.db.prepare('SELECT data FROM imports WHERE device_id=? ORDER BY rowid DESC LIMIT 20').all(deviceId).map(r => JSON.parse(r.data)); }
  saveImport(value) { this.db.prepare('INSERT INTO imports VALUES (?,?,?)').run(value.id, value.device_id, JSON.stringify(value)); }
  saveImportErrors(id, rows) { const insert = this.db.prepare('INSERT INTO import_errors VALUES (?,?,?)'); this.db.exec('BEGIN'); try { for (const row of rows) insert.run(id, row.row, JSON.stringify(row)); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  importErrors(id, limit = 100, offset = 0) { return { rows: this.db.prepare('SELECT data FROM import_errors WHERE import_id=? ORDER BY row_number LIMIT ? OFFSET ?').all(id, limit, offset).map(r => JSON.parse(r.data)), total: this.db.prepare('SELECT COUNT(*) AS total FROM import_errors WHERE import_id=?').get(id).total }; }
  rules() { return this.db.prepare('SELECT data FROM rules').all().map(r => JSON.parse(r.data)); }
  rule(id) {
    const row = this.db.prepare('SELECT data FROM rules WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  }

  ruleRevisions() {
    const rows = this.db.prepare('SELECT seq, previous_hash, entry_hash, payload FROM rule_revisions ORDER BY seq').all();
    const recent = [];
    const latest = new Map();
    let previousHash = GENESIS_HASH;
    let integrity = rows.length ? 'verified' : 'empty';
    for (const [index, row] of rows.entries()) {
      if (row.seq !== index + 1 || row.previous_hash !== previousHash ||
          row.entry_hash !== revisionHash(row.seq, previousHash, row.payload)) {
        integrity = 'mismatch';
      }
      previousHash = row.entry_hash;
      try {
        const event = JSON.parse(row.payload);
        if (!event || typeof event.rule_id !== 'string' || event.before?.id !== event.rule_id ||
            event.after?.id !== event.rule_id || event.after.version !== event.before.version + 1) {
          integrity = 'mismatch';
          continue;
        }
        const prior = latest.get(event.rule_id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(event.before)) integrity = 'mismatch';
        latest.set(event.rule_id, event.after);
        if (index >= rows.length - 25) {
          const { payload, ...record } = row;
          recent.push({ ...event, ...record });
        }
      } catch {
        integrity = 'mismatch';
      }
    }
    for (const [id, snapshot] of latest) {
      if (JSON.stringify(snapshot) !== JSON.stringify(this.rule(id))) integrity = 'mismatch';
    }
    return { integrity, entries: recent.reverse(), total: rows.length };
  }

  setRule(rule, { expectedVersion, reason, changedAt }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.rule(rule.id);
      if (previous.version !== expectedVersion) {
        this.db.exec('ROLLBACK');
        return { error: 'RULE_VERSION_CONFLICT' };
      }
      if (this.ruleRevisions().integrity === 'mismatch') {
        this.db.exec('ROLLBACK');
        return { error: 'RULE_INTEGRITY_MISMATCH' };
      }
      if (JSON.stringify(previous) === JSON.stringify(rule)) {
        this.db.exec('COMMIT');
        return { rule: previous };
      }
      const after = { ...rule, version: previous.version + 1, updated_at: changedAt };
      const head = this.db.prepare('SELECT seq, entry_hash FROM rule_revisions ORDER BY seq DESC LIMIT 1').get();
      const seq = (head?.seq ?? 0) + 1;
      const previousHash = head?.entry_hash ?? GENESIS_HASH;
      const payload = JSON.stringify({ rule_id: rule.id, changed_at: changedAt, reason, before: previous, after });
      this.db.prepare('UPDATE rules SET data=? WHERE id=?').run(JSON.stringify(after), rule.id);
      this.db.prepare('INSERT INTO rule_revisions VALUES (?,?,?,?)')
        .run(seq, previousHash, revisionHash(seq, previousHash, payload), payload);
      this.audit('rule_updated', after);
      this.db.exec('COMMIT');
      this.invalidate();
      return { rule: after };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  alerts(deviceId) { return this.db.prepare('SELECT data FROM alerts WHERE device_id=? ORDER BY rowid DESC LIMIT 500').all(deviceId).map(r => JSON.parse(r.data)); }
  saveAlerts(events) {
    for (let event of events) {
      const existing = this.db.prepare('SELECT data FROM alerts WHERE id=?').get(event.id);
      if (existing) { const old = JSON.parse(existing.data); event = { ...event, acknowledged_at: old.acknowledged_at, status: old.acknowledged_at && !event.ended_at && event.source === 'live' ? 'acknowledged' : event.status }; }
      this.db.prepare('INSERT OR REPLACE INTO alerts VALUES (?,?,?)').run(event.id, event.device_id, JSON.stringify(event));
    }
  }
  acknowledge(id, now) { const record = this.db.prepare('SELECT data FROM alerts WHERE id=?').get(id); if (!record) return null; const event = JSON.parse(record.data); event.acknowledged_at ||= now; if (event.status === 'active') event.status = 'acknowledged'; this.db.prepare('UPDATE alerts SET data=? WHERE id=?').run(JSON.stringify(event), id); this.audit('alert_acknowledged', { id, acknowledged_at: event.acknowledged_at }); return event; }
  batch(deviceId, id) { return this.db.prepare('SELECT fingerprint,result FROM batches WHERE device_id=? AND id=?').get(deviceId, id); }
  saveBatch(deviceId, id, fingerprint, result) { this.db.prepare('INSERT INTO batches VALUES (?,?,?,?)').run(deviceId, id, fingerprint, JSON.stringify(result)); }
  enqueueBuzzer(event, now) {
    if (event.source !== 'live' || event.ended_at || !['active', 'acknowledged'].includes(event.status) || !this.getDevice(event.device_id)?.buzzer_supported) return null;
    const origin = Date.parse(event.escalated_at || event.started_at), at = Date.parse(now);
    if (!Number.isFinite(origin) || origin + 30000 <= at || !['warning', 'critical'].includes(event.severity)) return null;
    const command = { id: crypto.randomUUID(), device_id: event.device_id, alert_id: event.id, type: 'buzzer', pattern: event.severity, expires_at: new Date(origin + 30000).toISOString(), status: 'pending', created_at: now };
    const result = this.db.prepare('INSERT OR IGNORE INTO commands VALUES (?,?,?,?,?,?,?)').run(command.id, command.device_id, command.alert_id, command.pattern, command.expires_at, command.status, JSON.stringify(command));
    return result.changes ? command : null;
  }
  command(id) { const row = this.db.prepare('SELECT data FROM commands WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  pendingCommands(deviceId, now) {
    const expired = this.db.prepare("SELECT data FROM commands WHERE device_id=? AND status='pending' AND expires_at<=?").all(deviceId, now);
    for (const row of expired) { const command = JSON.parse(row.data); command.status = 'expired'; this.db.prepare('UPDATE commands SET status=?,data=? WHERE id=?').run(command.status, JSON.stringify(command), command.id); }
    if (!this.getDevice(deviceId)?.buzzer_supported) return [];
    return this.db.prepare("SELECT data FROM commands WHERE device_id=? AND status='pending' AND expires_at>? ORDER BY expires_at LIMIT 100").all(deviceId, now).map(r => JSON.parse(r.data));
  }
  acknowledgeCommand(id, status, now) {
    const command = this.command(id); if (!command) return null;
    if (command.status !== 'pending') return command;
    command.status = command.expires_at <= now ? 'expired' : status;
    command.acknowledged_at = now;
    this.db.prepare('UPDATE commands SET status=?,data=? WHERE id=?').run(command.status, JSON.stringify(command), id);
    this.audit('command_acknowledged', { id, device_id: command.device_id, status: command.status }); return command;
  }
  audit(action, data) { this.db.prepare('INSERT INTO audit(created_at,action,data) VALUES (?,?,?)').run(new Date().toISOString(), action, JSON.stringify(data)); }
  close() { this.db.close(); }
}
module.exports = { Store };
