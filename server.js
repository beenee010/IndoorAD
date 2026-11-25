const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./lib/store');
const { METRICS, numeric, parseTimestamp, parseCsv, classifyQuality, aggregateSeries, analyzeRows, LiveAlertEngine } = require('./lib/engine');
const ROOT = __dirname;
const STATIC = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/script.js': ['script.js', 'text/javascript'] };
const problem = (status, code, message) => Object.assign(new Error(message), { status, code });
function sendJson(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function readJson(req, limit = 22 * 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw problem(415, 'CONTENT_TYPE', 'JSON 형식으로 전송해 주세요');
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > limit) throw problem(413, 'BODY_TOO_LARGE', '파일은 20MB 이하로 나누어 주세요'); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw problem(400, 'INVALID_JSON', 'JSON 형식을 확인해 주세요'); }
}
function createApp(options = {}) {
  const store = new Store(options.dbPath || process.env.AIRGUARD_DB_PATH || path.join(ROOT, 'data', 'airguard.sqlite'));
  const deviceToken = options.deviceToken ?? process.env.AIRGUARD_DEVICE_TOKEN;
  const nowMs = () => { const value = options.now ? options.now() : Date.now(); return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value); };
  const nowIso = () => new Date(nowMs()).toISOString();
  const pending = new Map(), clients = new Set(), cache = new Map(), outdoorCache = new Map(), liveEngines = new Map();
  function refresh(id) { cache.clear(); for (const res of clients) res.write(`event: refresh\ndata: ${JSON.stringify({ device_id: id, at: nowIso() })}\n\n`); }
  function device(id) { const d = store.getDevice(id || 'lab-01'); if (!d) throw problem(404, 'DEVICE_NOT_FOUND', '장치를 찾을 수 없습니다'); return d; }
  function authenticateDevice(req, id) {
    const auth = req.headers.authorization || '', token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!deviceToken || Buffer.byteLength(token) !== Buffer.byteLength(deviceToken) || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(deviceToken))) throw problem(401, 'DEVICE_AUTH', '장치 인증 토큰이 필요합니다');
    if (id !== (options.tokenDeviceId || process.env.AIRGUARD_DEVICE_ID || 'lab-01')) throw problem(403, 'TOKEN_DEVICE', '이 토큰의 장치 ID와 일치하지 않습니다');
  }
  function range(url, d, mode = 'historical') {
    const all = store.rows(d.id).filter(r => mode !== 'live' || r.source === 'live'), defaultEnd = mode === 'live' ? nowMs() : all.length ? Date.parse(all.at(-1).measured_at) + 1000 : nowMs();
    const to = url.searchParams.has('to') ? parseTimestamp(url.searchParams.get('to'), 'UTC', true) : new Date(defaultEnd).toISOString();
    const from = url.searchParams.has('from') ? parseTimestamp(url.searchParams.get('from'), 'UTC', true) : new Date(defaultEnd - 86400000).toISOString();
    if (!from || !to || Date.parse(from) >= Date.parse(to) || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw problem(400, 'INVALID_RANGE', '조회 기간은 1년 이내의 올바른 시각으로 지정해 주세요');
    return { from, to, all, rows: all.filter(r => r.measured_at >= from && r.measured_at < to) };
  }
  function ingestCsv(csv, filename, deviceId, timezone) {
    if (Buffer.byteLength(csv || '', 'utf8') > 20 * 1024 * 1024) throw problem(413, 'CSV_TOO_LARGE', 'CSV 파일은 20MB 이하로 나누어 주세요');
    device(deviceId); let parsed; try { parsed = parseCsv(csv, timezone); } catch (e) { throw problem(400, 'INVALID_CSV', e.message); }
    const checks = store.checkRows(deviceId, parsed.rows), token = crypto.randomUUID();
    const report = { validation_token: token, filename: String(filename || 'air_log.csv').slice(0, 200), rows: parsed.total_rows, valid_rows: parsed.rows.length, duplicates: checks.duplicates, conflicts: checks.conflicts, invalid: parsed.invalid, invalid_by_metric: parsed.invalid_by_metric, missing_by_metric: parsed.missing_by_metric, start: parsed.rows[0]?.measured_at || null, end: parsed.rows.at(-1)?.measured_at || null, preview: parsed.preview, error_preview: parsed.quarantine.slice(0, 20), warnings: ['CSV는 기록 분석으로 저장되어 현재 경고음이 발생하지 않습니다', '센서 사양과 읽기 상태가 없어 품질은 미확인으로 표시합니다', ...(parsed.unsupported_channels.length ? [`미지원 컬럼: ${parsed.unsupported_channels.join(', ')}`] : [])] };
    for (const [key, item] of pending) if (item.expires < nowMs()) pending.delete(key);
    if (pending.size >= 3) pending.delete(pending.keys().next().value);
    pending.set(token, { parsed, report, deviceId, timezone, hash: crypto.createHash('sha256').update(csv).digest('hex'), expires: nowMs() + 900000 });
    return report;
  }
  function commitCsv(token) {
    const item = pending.get(token); if (!item || item.expires < nowMs()) throw problem(400, 'VALIDATION_EXPIRED', '검증이 만료되었습니다 파일을 다시 검증해 주세요');
    pending.delete(token); const id = crypto.randomUUID(), result = store.insertRows(item.deviceId, item.parsed.rows, { importId: id, now: nowIso(), invalid: item.parsed.invalid });
    store.saveImport({ id, import_id: id, device_id: item.deviceId, filename: item.report.filename, file_hash: item.hash, timezone: item.timezone, created_at: nowIso(), start: item.report.start, end: item.report.end, ...result, missing_by_metric: item.parsed.missing_by_metric });
    store.saveImportErrors(id, item.parsed.quarantine);
    store.audit('csv_imported', { id, device_id: item.deviceId, ...result }); refresh(item.deviceId); return { import_id: id, ...result };
  }
  const seed = options.seedCsv ?? process.env.SEED_CSV;
  if (seed && !store.db.prepare('SELECT device_id FROM measurements LIMIT 1').get()) { const report = ingestCsv(fs.readFileSync(seed, 'utf8'), path.basename(seed), 'lab-01', 'Asia/Seoul'); commitCsv(report.validation_token); }
  function evaluateLive(id) {
    const rules = store.rules(), windowMs = Math.max(60, ...rules.map(r => r.window_seconds)) * 1000 + 3000;
    const recent = store.rows(id).filter(r => r.source === 'live' && Date.parse(r.measured_at) >= nowMs() - windowMs && Date.parse(r.measured_at) <= nowMs());
    if (!liveEngines.has(id)) liveEngines.set(id, new LiveAlertEngine(id, store.alerts(id)));
    const events = liveEngines.get(id).step(recent, rules, nowMs());
    if (events.length) {
      const previous = new Map(store.alerts(id).map(e => [e.id, e]));
      for (const event of events) { const old = previous.get(event.id); if (!old || (old.severity !== event.severity && event.severity === 'critical')) store.enqueueBuzzer(event, nowIso()); }
      store.saveAlerts(events); refresh(id);
    }
  }
  async function outdoor(d) {
    const rawKey = options.airkoreaKey ?? process.env.AIRKOREA_SERVICE_KEY;
    if (!rawKey || !d.station_name) return { configured: Boolean(rawKey), station_name: d.station_name, observation: null, stale: true, message: !rawKey ? '서버의 AIRKOREA_SERVICE_KEY 설정이 필요합니다' : '장치의 외부 측정소를 선택해 주세요' };
    const old = outdoorCache.get(d.station_name);
    const result = (item, message) => { const time = item?.observation?.dataTime; const observed = time ? parseTimestamp(time.length === 16 ? time + ':00' : time) : null; return { configured: true, station_name: d.station_name, observation: item?.observation || null, fetched_at: item?.fetched_at || null, stale: !observed || nowMs() - Date.parse(observed) > 7200000, message }; };
    if (old && nowMs() - old.fetched_ms < 3600000) return result(old, '외부 측정소 참고 관측값');
    if (old?.failed_at && nowMs() - old.failed_at < 60000) return { ...result(old, '외부 관측을 불러오지 못했습니다 잠시 후 다시 시도해 주세요'), stale: true };
    let key; try { key = decodeURIComponent(rawKey); } catch { key = rawKey; }
    try {
      const params = new URLSearchParams({ serviceKey: key, stationName: d.station_name, dataTerm: 'DAILY', pageNo: '1', numOfRows: '1', returnType: 'json', ver: '1.4' });
      const response = await fetch(`https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty?${params}`, { signal: AbortSignal.timeout(8000) });
      const payload = await response.json(), observation = payload?.response?.body?.items?.[0]; if (!response.ok || !observation) throw new Error('upstream');
      const safe = Object.fromEntries(['stationName', 'dataTime', 'pm25Value', 'pm10Value', 'pm25Grade', 'pm10Grade', 'khaiValue', 'khaiGrade', 'o3Value'].map(k => [k, observation[k] ?? null]));
      const item = { observation: safe, fetched_ms: nowMs(), fetched_at: nowIso() }; if (outdoorCache.size >= 100) outdoorCache.delete(outdoorCache.keys().next().value); outdoorCache.set(d.station_name, item); return result(item, '외부 측정소 참고 관측값');
    } catch { outdoorCache.set(d.station_name, { ...old, failed_at: nowMs() }); return { ...result(old, '외부 관측을 불러오지 못했습니다 잠시 후 다시 시도해 주세요'), stale: true }; }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) throw problem(403, 'HOST_REJECTED', '로컬 대시보드 주소를 사용해 주세요');
      const url = new URL(req.url, `http://${host}`), pathname = url.pathname;
      if (!['GET', 'HEAD'].includes(req.method) && (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`))) throw problem(403, 'ORIGIN_REJECTED', '같은 대시보드 주소에서 요청해 주세요');
      if (['/api/health', '/api/v1/health'].includes(pathname)) return sendJson(res, 200, { ok: true, apiKeyConfigured: Boolean(options.airkoreaKey ?? process.env.AIRKOREA_SERVICE_KEY), deviceTokenConfigured: Boolean(deviceToken), version: '1.0' });
      if (pathname === '/api/v1/devices' && req.method === 'GET') return sendJson(res, 200, { devices: store.devices() });
      if (pathname === '/api/v1/devices' && req.method === 'POST') {
        const data = await readJson(req, 4096); if (!/^[a-zA-Z0-9_-]{1,64}$/.test(data.id || '') || store.getDevice(data.id)) throw problem(400, 'DEVICE_ID', '사용하지 않은 장치 ID를 입력해 주세요');
        return sendJson(res, 201, store.setDevice({ id: data.id, name: String(data.name || data.id).slice(0, 100), room: String(data.room || '').slice(0, 100), sensor_verified: false, buzzer_supported: false, station_name: '종로구', lat: null, lon: null }));
      }
      const dm = pathname.match(/^\/api\/v1\/devices\/([^/]+)$/);
      if (dm && req.method === 'PATCH') {
        const d = device(decodeURIComponent(dm[1])), data = await readJson(req, 4096);
        for (const k of ['name', 'room', 'station_name']) if (k in data) { if (typeof data[k] !== 'string' || data[k].length > 100) throw problem(400, 'DEVICE_FIELD', '장치 설정을 확인해 주세요'); d[k] = data[k]; }
        if ('sensor_verified' in data) { if (typeof data.sensor_verified !== 'boolean') throw problem(400, 'DEVICE_FIELD', '센서 확인 값은 true 또는 false입니다'); d.sensor_verified = data.sensor_verified; }
        if ('buzzer_supported' in data) { if (typeof data.buzzer_supported !== 'boolean') throw problem(400, 'DEVICE_FIELD', '부저 지원 값은 true 또는 false입니다'); d.buzzer_supported = data.buzzer_supported; }
        for (const [k, limit] of [['lat', 90], ['lon', 180]]) if (k in data) { if (data[k] !== null && (typeof data[k] !== 'number' || !Number.isFinite(data[k]) || Math.abs(data[k]) > limit)) throw problem(400, 'LOCATION', '좌표 범위를 확인해 주세요'); d[k] = data[k]; }
        store.setDevice(d); store.audit('device_updated', d); refresh(d.id); return sendJson(res, 200, d);
      }
      if (pathname === '/api/v1/imports/validate' && req.method === 'POST') {
        const data = await readJson(req); if (typeof data.csv !== 'string' || !['Asia/Seoul', 'UTC'].includes(data.timezone || 'Asia/Seoul')) throw problem(400, 'IMPORT_FIELDS', 'CSV와 지원하는 시간대를 입력해 주세요');
        return sendJson(res, 200, ingestCsv(data.csv, data.filename, data.device_id || 'lab-01', data.timezone || 'Asia/Seoul'));
      }
      if (pathname === '/api/v1/imports/commit' && req.method === 'POST') return sendJson(res, 200, commitCsv((await readJson(req, 4096)).validation_token));
      const importErrors = pathname.match(/^\/api\/v1\/imports\/([^/]+)\/errors$/);
      if (importErrors && req.method === 'GET') return sendJson(res, 200, store.importErrors(importErrors[1], Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 100)), Math.max(0, Number(url.searchParams.get('offset')) || 0)));
      const commandGet = pathname.match(/^\/api\/v1\/devices\/([^/]+)\/commands$/);
      if (commandGet && req.method === 'GET') { const id = decodeURIComponent(commandGet[1]); authenticateDevice(req, id); device(id); return sendJson(res, 200, { commands: store.pendingCommands(id, nowIso()) }); }
      const commandAck = pathname.match(/^\/api\/v1\/commands\/([^/]+)\/ack$/);
      if (commandAck && req.method === 'POST') {
        const id = decodeURIComponent(commandAck[1]); authenticateDevice(req, options.tokenDeviceId || process.env.AIRGUARD_DEVICE_ID || 'lab-01');
        const command = store.command(id); if (!command) throw problem(404, 'COMMAND_NOT_FOUND', '명령을 찾을 수 없습니다'); authenticateDevice(req, command.device_id);
        const body = await readJson(req, 4096); if (!['executed', 'failed'].includes(body.status)) throw problem(400, 'COMMAND_STATUS', '명령 결과는 executed 또는 failed입니다');
        const updated = store.acknowledgeCommand(id, body.status, nowIso()); if (updated.status === 'expired') throw problem(410, 'COMMAND_EXPIRED', '만료된 명령은 실행할 수 없습니다'); return sendJson(res, 200, updated);
      }
      if (pathname === '/api/v1/measurements/batch' && req.method === 'POST') {
        authenticateDevice(req, options.tokenDeviceId || process.env.AIRGUARD_DEVICE_ID || 'lab-01');
        const data = await readJson(req, 256 * 1024), d = device(data.device_id);
        authenticateDevice(req, d.id);
        if (data.schema_version !== '1.0' || typeof data.batch_id !== 'string' || !data.batch_id || data.batch_id.length > 200 || !Array.isArray(data.samples) || !data.samples.length || data.samples.length > 100) throw problem(400, 'BATCH_FIELDS', '배치 ID와 규격 1.0과 최대 100개의 측정값이 필요합니다');
        const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'), old = store.batch(d.id, data.batch_id);
        if (old) { if (old.fingerprint !== hash) throw problem(409, 'BATCH_CONFLICT', '같은 배치 ID에 다른 내용이 전송되었습니다'); return sendJson(res, 200, JSON.parse(old.result)); }
        const rows = [], errors = []; let invalid = 0;
        for (let i = 0; i < data.samples.length; i++) {
          const s = data.samples[i], at = parseTimestamp(s?.measured_at, 'UTC', true);
          if (!at || Date.parse(at) > nowMs() + 30000 || !s.metrics || typeof s.metrics !== 'object' || Array.isArray(s.metrics)) { invalid++; errors.push({ index: i, reason: '측정 시각 또는 센서 객체가 올바르지 않습니다' }); continue; }
          const metrics = {}, quality = {};
          for (const m of METRICS) {
            const value = s.metrics[m], bad = value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value)); metrics[m] = bad ? null : numeric(value);
            const group = m.startsWith('dht') ? 'dht' : m.startsWith('am_') ? 'am' : 'air'; quality[m] = classifyQuality(m, metrics[m], { verified: d.sensor_verified, readStatus: s.read_status?.[m] || s.read_status?.[group], invalid: bad });
          }
          rows.push({ measured_at: at, metrics, quality, read_status: s.read_status || {}, sample_id: s.sample_id || null, raw: s.metrics, source: nowMs() - Date.parse(at) > 30000 ? 'backfill' : 'live', time_source: s.time_source === 'gateway' ? 'gateway' : 'device' });
        }
        const result = { ...store.insertRows(d.id, rows, { now: nowIso(), invalid }), batch_id: data.batch_id, errors }; store.saveBatch(d.id, data.batch_id, hash, result);
        if (rows.some(r => r.source === 'live')) evaluateLive(d.id);
        refresh(d.id); return sendJson(res, 200, result);
      }
      if (pathname === '/api/v1/alert-rules' && req.method === 'GET') return sendJson(res, 200, { rules: store.rules() });
      if (pathname === '/api/v1/alert-rule-revisions' && req.method === 'GET') return sendJson(res, 200, store.ruleRevisions());
      const rm = pathname.match(/^\/api\/v1\/alert-rules\/([^/]+)$/);
      if (rm && req.method === 'PUT') {
        const data = await readJson(req, 4096);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem(400, 'RULE_VALUE', '규칙 설정을 확인해 주세요');
        const rule = store.rule(rm[1]);
        if (!rule) throw problem(404, 'RULE_NOT_FOUND', '규칙을 찾을 수 없습니다');
        const reviewed = 'expected_version' in data || 'reason' in data;
        if (reviewed && (!Number.isSafeInteger(data.expected_version) || data.expected_version < 1 ||
            typeof data.reason !== 'string' || !data.reason.trim() || data.reason.trim().length > 300)) {
          throw problem(400, 'RULE_REVIEW_REQUIRED', '검토한 버전과 300자 이내의 변경 사유를 입력해 주세요');
        }
        for (const k of ['threshold', 'clear_threshold', 'hold_seconds', 'clear_hold_seconds', 'window_seconds']) if (k in data) { if (typeof data[k] !== 'number' || !Number.isFinite(data[k]) || data[k] < 0 || data[k] > 86400) throw problem(400, 'RULE_VALUE', '규칙 숫자와 지속시간을 확인해 주세요'); rule[k] = data[k]; }
        if (rule.hold_seconds < 10 || rule.clear_hold_seconds < 10 || rule.window_seconds < 10 || rule.clear_threshold >= rule.threshold) throw problem(400, 'RULE_VALUE', '해제 기준은 발생 기준보다 낮고 기간은 10초 이상이어야 합니다');
        if ('enabled' in data) { if (typeof data.enabled !== 'boolean') throw problem(400, 'RULE_VALUE', '규칙 활성화는 true 또는 false입니다'); rule.enabled = data.enabled; }
        const result = store.setRule(rule, {
          expectedVersion: reviewed ? data.expected_version : rule.version,
          reason: reviewed ? data.reason.trim() : null,
          changedAt: nowIso(),
        });
        if (result.error === 'RULE_VERSION_CONFLICT') throw problem(409, result.error, '다른 변경이 먼저 저장되었습니다. 최신 버전을 다시 검토해 주세요');
        if (result.error === 'RULE_INTEGRITY_MISMATCH') throw problem(409, result.error, '경고 규칙과 변경 이력이 일치하지 않아 저장할 수 없습니다');
        refresh(null);
        return sendJson(res, 200, result.rule);
      }
      const am = pathname.match(/^\/api\/v1\/alerts\/([^/]+)\/ack$/);
      if (am && req.method === 'POST') { const event = store.acknowledge(decodeURIComponent(am[1]), nowIso()); if (!event) throw problem(404, 'ALERT_NOT_FOUND', '경고를 찾을 수 없습니다'); refresh(event.device_id); return sendJson(res, 200, event); }
      if (pathname === '/api/v1/outdoor' && req.method === 'GET') return sendJson(res, 200, await outdoor(device(url.searchParams.get('device_id'))));
      if (pathname === '/api/v1/events' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
      if (['/api/v1/dashboard', '/api/v1/series', '/api/v1/measurements', '/api/v1/export', '/api/v1/alerts'].includes(pathname) && req.method === 'GET') {
        const d = device(url.searchParams.get('device_id')), mode = url.searchParams.get('mode') || 'historical'; if (!['live', 'historical'].includes(mode)) throw problem(400, 'INVALID_MODE', '실시간 또는 기록 분석 모드를 선택해 주세요');
        const r = range(url, d, mode);
        if (pathname === '/api/v1/alerts') return sendJson(res, 200, { alerts: store.alerts(d.id).filter(a => mode === 'live' ? a.source === 'live' : a.source === 'historical') });
        if (pathname === '/api/v1/measurements') { const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 50)), offset = Math.max(0, Number(url.searchParams.get('offset')) || 0); return sendJson(res, 200, { rows: r.rows.slice(offset, offset + limit).map(row => ({ timestamp: row.measured_at, ...row, ...row.metrics })), total: r.rows.length }); }
        if (pathname === '/api/v1/export') { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="airguard-${d.id}.csv"` }); res.write('\uFEFFtimestamp,' + METRICS.join(',') + '\r\n'); for (const row of r.rows) if (!res.write(row.measured_at + ',' + METRICS.map(m => row.metrics[m] ?? '').join(',') + '\r\n')) await new Promise(resolve => res.once('drain', resolve)); return res.end(); }
        const key = `${store.version}:${pathname}:${url.search}`; if (mode !== 'live' && cache.has(key)) return sendJson(res, 200, cache.get(key)); let result;
        if (pathname === '/api/v1/series') { const metric = url.searchParams.get('metric') || 'pm25_ugm3', interval = url.searchParams.get('interval') || 'auto'; if (!METRICS.includes(metric) || !['auto', '5s', '10s', '1m', '10m'].includes(interval)) throw problem(400, 'SERIES_FIELDS', '지표 또는 집계 간격을 확인해 주세요'); result = aggregateSeries(r.all.filter(row => row.measured_at >= new Date(Date.parse(r.from) - 3000).toISOString() && row.measured_at < r.to), metric, r.from, r.to, interval); }
        else {
          const asOf = mode === 'live' ? nowIso() : r.rows.at(-1)?.measured_at || r.to, analyzed = analyzeRows(r.rows, asOf, mode), alerts = store.alerts(d.id).filter(a => mode === 'live' ? a.source === 'live' : a.source === 'historical'), active = alerts.filter(a => !a.ended_at && ['active', 'acknowledged'].includes(a.status)), qualities = ['pm25_ugm3', 'co2_ppm'].map(m => analyzed.metrics[m].quality);
          const spike = r.rows.filter((row, i) => i && Date.parse(row.measured_at) - Date.parse(r.rows[i - 1].measured_at) <= 3000 && Number.isFinite(row.metrics.pm25_ugm3) && Number.isFinite(r.rows[i - 1].metrics.pm25_ugm3) && Math.abs(row.metrics.pm25_ugm3 - r.rows[i - 1].metrics.pm25_ugm3) > Math.max(100, r.rows[i - 1].metrics.pm25_ugm3 * 2));
          result = { device: d, mode, as_of: asOf, overall_status: mode === 'live' && active.length ? active.some(a => a.severity === 'critical') ? 'critical' : 'warning' : qualities.every(q => q === 'valid') && ['pm25_ugm3', 'co2_ppm'].every(m => analyzed.metrics[m].coverage_60s >= .8) ? 'normal' : 'undetermined', ...analyzed, alerts, active_alerts: mode === 'live' ? active : [], quality_events: [...(analyzed.summary.gap_count ? [{ type: 'gap', message: `${analyzed.summary.gap_count}개의 3초 초과 공백`, duration_seconds: analyzed.summary.longest_gap_seconds }] : []), ...(analyzed.summary.flat_channels.length ? [{ type: 'flat', channels: analyzed.summary.flat_channels, message: 'CO₂와 AM 온습도가 30분 이상 함께 고정된 구간이 있습니다' }] : []), ...(spike.length ? [{ type: 'spike', metric: 'pm25_ugm3', count: spike.length, message: '짧은 시간에 PM2.5가 크게 변한 점검 후보 구간이 있습니다 원시값은 보존됩니다' }] : [])], imports: store.imports(d.id) };
        }
        if (mode !== 'live') { if (cache.size >= 30) cache.delete(cache.keys().next().value); cache.set(key, result); } return sendJson(res, 200, result);
      }
      if (STATIC[pathname] && ['GET', 'HEAD'].includes(req.method)) { const [file, type] = STATIC[pathname]; res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" }); return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(ROOT, file))); }
      throw problem(404, 'NOT_FOUND', '요청한 페이지를 찾을 수 없습니다');
    } catch (e) { if (!res.headersSent) sendJson(res, e.status || 500, { error_code: e.code || 'INTERNAL_ERROR', message: e.status ? e.message : '요청 처리 중 오류가 발생했습니다', request_id: crypto.randomUUID() }); else res.end(); }
  });
  server.requestTimeout = 30000;
  const evaluator = setInterval(() => { for (const d of store.devices()) if (store.rows(d.id).some(r => r.source === 'live')) evaluateLive(d.id); }, 10000); evaluator.unref();
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 25000); heartbeat.unref();
  const close = async () => { clearInterval(heartbeat); clearInterval(evaluator); for (const res of clients) res.end(); clients.clear(); await new Promise((resolve, reject) => { if (!server.listening) return resolve(); server.close(e => e ? reject(e) : resolve()); server.closeIdleConnections(); }); store.close(); };
  return { server, close, store };
}
if (require.main === module) { const app = createApp(); app.server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`AirGuard dashboard: http://127.0.0.1:${process.env.PORT || 4173}`)); for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0))); }
module.exports = { createApp };
