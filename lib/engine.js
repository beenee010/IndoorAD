const METRICS = ['dht_temp_C', 'dht_humi_pct', 'am_temp_C', 'am_humi_pct', 'co2_ppm', 'voc_level', 'pm25_ugm3'];
const UNITS = { dht_temp_C: '°C', am_temp_C: '°C', dht_humi_pct: '%', am_humi_pct: '%', co2_ppm: 'ppm', pm25_ugm3: 'µg/m³', voc_level: '단계' };
const DEFAULT_RULES = [
  { id: 'pm25-warning', metric: 'pm25_ugm3', severity: 'warning', operator: '>', threshold: 35, clear_threshold: 30, hold_seconds: 300 },
  { id: 'pm25-critical', metric: 'pm25_ugm3', severity: 'critical', operator: '>', threshold: 75, clear_threshold: 65, hold_seconds: 120 },
  { id: 'co2-warning', metric: 'co2_ppm', severity: 'warning', operator: '>=', threshold: 1000, clear_threshold: 900, hold_seconds: 300 },
  { id: 'co2-critical', metric: 'co2_ppm', severity: 'critical', operator: '>=', threshold: 1500, clear_threshold: 1300, hold_seconds: 120 },
].map(r => ({ ...r, enabled: true, window_seconds: 60, clear_hold_seconds: 300, version: 1 }));

function parseTimestamp(value, timezone = 'Asia/Seoul', requireZone = false) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(v);
  if (requireZone && !hasZone) return null;
  if (!hasZone) {
    if (!['Asia/Seoul', 'UTC'].includes(timezone) || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(v)) return null;
    v = v.replace(' ', 'T') + (timezone === 'Asia/Seoul' ? '+09:00' : 'Z');
  }
  const match = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate() || h > 23 || min > 59 || s > 59) return null;
  const time = Date.parse(v);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function classifyQuality(metric, value, { verified = false, readStatus, flat = false, invalid = false } = {}) {
  if (invalid) return { quality: 'invalid', quality_reasons: ['숫자로 해석할 수 없는 값'] };
  if (value === null || value === undefined || readStatus === 'error') return { quality: 'missing', quality_reasons: [readStatus === 'error' ? '센서 읽기 실패' : '수집 안 됨'] };
  if (!Number.isFinite(value) || (['co2_ppm', 'pm25_ugm3'].includes(metric) && value < 0) || (metric.includes('humi') && (value < 0 || value > 100)) || (metric === 'voc_level' && (!Number.isInteger(value) || value < 0))) return { quality: 'invalid', quality_reasons: ['허용 형식 또는 범위 밖의 값'] };
  if (flat) return { quality: 'suspect', quality_reasons: ['CO₂와 AM 온습도가 30분 이상 함께 고정됨'] };
  if (!verified || readStatus !== 'ok') return { quality: 'unknown', quality_reasons: [!verified ? '센서 사양 미확인' : '읽기 상태 미확인'] };
  return { quality: 'valid', quality_reasons: [] };
}

function parseCsv(csv, timezone = 'Asia/Seoul') {
  if (typeof csv !== 'string') throw new Error('CSV 문자열이 필요합니다');
  const records = []; let cells = []; let cell = ''; let quoted = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else if (!cell || quoted) quoted = !quoted; else cell += c; }
    else if (c === ',' && !quoted) { cells.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { cells.push(cell); if (cells.some(v => v.trim())) records.push(cells); cells = []; cell = ''; if (c === '\r' && input[i + 1] === '\n') i++; }
    else cell += c;
  }
  if (quoted) throw new Error('닫히지 않은 CSV 따옴표가 있습니다');
  if (cell || cells.length) { cells.push(cell); if (cells.some(v => v.trim())) records.push(cells); }
  const header = (records.shift() || []).map(s => s.trim());
  if (!header.includes('timestamp') || !METRICS.some(m => header.includes(m))) throw new Error('timestamp와 하나 이상의 센서 컬럼이 필요합니다');
  if (new Set(header).size !== header.length) throw new Error('CSV 컬럼 이름이 중복됩니다');
  if (records.length > 500000) throw new Error('최대 500000행을 가져올 수 있습니다');
  const rows = [], preview = [], quarantine = [], channelErrors = Object.fromEntries(METRICS.map(m => [m, 0])), missing = Object.fromEntries(METRICS.map(m => [m, 0])); let invalid = 0;
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    const raw = Object.fromEntries(header.map((h, i) => [h, record[i] ?? '']));
    const measured_at = parseTimestamp(raw.timestamp, timezone);
    const metrics = {}, quality = {};
    for (const m of METRICS) {
      metrics[m] = numeric(raw[m]);
      const bad = raw[m] !== undefined && raw[m].trim() !== '' && metrics[m] === null;
      quality[m] = classifyQuality(m, metrics[m], { invalid: bad });
      if (quality[m].quality === 'invalid') channelErrors[m]++;
      if (metrics[m] === null) missing[m]++;
    }
    if (preview.length < 20) preview.push({ timestamp: raw.timestamp, ...metrics });
    if (!measured_at || record.length !== header.length) { invalid++; quarantine.push({ row: recordIndex + 2, raw, reason: !measured_at ? '시각 해석 실패' : '컬럼 수 불일치' }); continue; }
    rows.push({ measured_at, metrics, quality, source: 'csv', time_source: 'import', read_status: {}, raw });
  }
  rows.sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  return { rows, total_rows: records.length, invalid, quarantine, invalid_by_metric: channelErrors, missing_by_metric: missing, preview, unsupported_channels: METRICS.filter(m => !header.includes(m)) };
}

function rowTime(row) { return Date.parse(row.measured_at || row.timestamp); }
function rowValue(row, metric) { return row.metrics ? row.metrics[metric] : row[metric]; }
function rowQuality(row, metric) { return row.quality?.[metric]?.quality || row.quality?.[metric] || 'unknown'; }

function applyFlatQuality(rows) {
  let started = null, previous = null; const channels = ['co2_ppm', 'am_temp_C', 'am_humi_pct'];
  for (const r of rows) {
    const t = rowTime(r), complete = channels.every(m => Number.isFinite(rowValue(r, m)));
    const same = previous && complete && channels.every(m => rowValue(r, m) === rowValue(previous, m)) && t - rowTime(previous) <= 3000;
    if (!same) started = complete ? t : null;
    if (started !== null && t - started >= 1800000) for (const m of channels) { if (!['invalid', 'missing'].includes(rowQuality(r, m))) r.quality[m] = classifyQuality(m, rowValue(r, m), { flat: true }); }
    previous = r;
  }
  return rows;
}

function weightedStats(rows, metric, from, to, { validOnly = false } = {}) {
  const a = typeof from === 'number' ? from : Date.parse(from), b = typeof to === 'number' ? to : Date.parse(to);
  let sum = 0, duration = 0, min = Infinity, max = -Infinity, validDuration = 0, changes = 0, current = null; const qualities = new Set(), categoryDurations = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], t = rowTime(row); if (t >= b) break;
    const end = Math.min(b, t + 3000, i + 1 < rows.length ? rowTime(rows[i + 1]) : t + 1000), start = Math.max(a, t);
    const q = rowQuality(row, metric), v = rowValue(row, metric), dt = end - start;
    if (dt <= 0 || !Number.isFinite(v) || ['missing', 'invalid', 'suspect'].includes(q)) continue;
    qualities.add(q);
    if (q === 'valid') validDuration += dt;
    if (validOnly && q !== 'valid') continue;
    sum += v * dt; duration += dt; min = Math.min(min, v); max = Math.max(max, v);
    if (metric === 'voc_level') { categoryDurations[v] = (categoryDurations[v] || 0) + dt / 1000; if (current !== null && current !== v) changes++; current = v; }
  }
  return { mean: metric === 'voc_level' ? null : duration ? sum / duration : null, min: duration ? min : null, max: duration ? max : null, coverage: b > a ? Math.min(1, duration / (b - a)) : 0, valid_coverage: b > a ? Math.min(1, validDuration / (b - a)) : 0, quality: !duration ? 'missing' : qualities.has('unknown') ? 'unknown' : 'valid', ...(metric === 'voc_level' ? { category_durations_seconds: categoryDurations, changes, current } : {}) };
}

function aggregateSeries(rows, metric, from, to, interval = 'auto') {
  const start = Date.parse(from), end = Date.parse(to), span = (end - start) / 1000;
  let step = ({ '5s': 5, '10s': 10, '1m': 60, '10m': 600 })[interval] || (span <= 900 ? 5 : span <= 3600 ? 10 : span <= 86400 ? 60 : 600);
  step = Math.max(step, Math.ceil(span / 1500));
  const buckets = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], t = rowTime(r), until = Math.min(end, t + 3000, i + 1 < rows.length ? rowTime(rows[i + 1]) : t + 1000), v = rowValue(r, metric), q = rowQuality(r, metric);
    if (t >= end) break;
    if (until <= start || !Number.isFinite(v) || ['missing', 'invalid', 'suspect'].includes(q)) continue;
    for (let cur = Math.max(t, start); cur < until;) {
      const idx = Math.floor((cur - start) / (step * 1000)), stop = Math.min(until, start + (idx + 1) * step * 1000);
      const bucket = buckets.get(idx) || { sum: 0, ms: 0, min: Infinity, max: -Infinity, quality: 'valid', category_durations_seconds: {}, current: null };
      bucket.sum += v * (stop - cur); bucket.ms += stop - cur; bucket.min = Math.min(bucket.min, v); bucket.max = Math.max(bucket.max, v); if (q !== 'valid') bucket.quality = q;
      if (metric === 'voc_level') { bucket.category_durations_seconds[v] = (bucket.category_durations_seconds[v] || 0) + (stop - cur) / 1000; bucket.current = v; }
      buckets.set(idx, bucket); cur = stop;
    }
  }
  const points = [];
  for (let i = 0; i < Math.ceil(span / step); i++) {
    const bucket = buckets.get(i), ms = Math.min(step * 1000, end - start - i * step * 1000);
    points.push({ time: new Date(start + i * step * 1000).toISOString(), mean: metric === 'voc_level' ? null : bucket ? bucket.sum / bucket.ms : null, min: bucket?.min ?? null, max: bucket?.max ?? null, coverage: bucket ? bucket.ms / ms : 0, quality: bucket?.quality || 'missing', ...(metric === 'voc_level' ? { category: bucket?.current ?? null, category_durations_seconds: bucket?.category_durations_seconds || {} } : {}) });
  }
  return { points, interval_seconds: step, from, to };
}

function analyzeRows(rows, asOf, mode = 'historical') {
  const missing = Object.fromEntries(METRICS.map(m => [m, 0])); let gap_count = 0, longest_gap_seconds = 0; const flat = new Set();
  for (let i = 0; i < rows.length; i++) {
    for (const m of METRICS) { if (rowValue(rows[i], m) === null) missing[m]++; if (rowQuality(rows[i], m) === 'suspect') flat.add(m); }
    if (i) { const gap = (rowTime(rows[i]) - rowTime(rows[i - 1])) / 1000; if (gap > 3) { gap_count++; longest_gap_seconds = Math.max(longest_gap_seconds, gap); } }
  }
  const latest = rows.at(-1), end = Date.parse(asOf), metrics = {};
  for (const m of METRICS) {
    const windowRows = rows.filter(r => rowTime(r) >= end - 63000 && rowTime(r) <= end);
    const short = weightedStats(windowRows, m, end - 60000, end, { validOnly: true });
    const all = rows.length ? weightedStats(rows, m, rowTime(rows[0]), rowTime(latest) + 1000) : { min: null, max: null, mean: null };
    const q = latest?.quality?.[m] || classifyQuality(m, null);
    const stale = mode === 'live' && (!latest || end - rowTime(latest) > 15000);
    metrics[m] = { latest: latest ? rowValue(latest, m) : null, mean_60s: short.coverage >= .8 ? short.mean : null, reference_mean_60s: weightedStats(windowRows, m, end - 60000, end).mean, min: all.min, max: all.max, mean: all.mean, quality: stale ? 'stale' : q.quality, quality_reasons: stale ? ['실시간 측정 수신 지연'] : q.quality_reasons, coverage_60s: short.coverage, unit: UNITS[m], ...(m === 'voc_level' ? { category_durations_seconds: all.category_durations_seconds || {}, changes: all.changes || 0 } : {}) };
  }
  return { metrics, summary: { rows: rows.length, start: rows[0]?.measured_at || null, end: latest?.measured_at || null, gap_count, longest_gap_seconds, missing_by_metric: missing, flat_channels: [...flat], latest: latest ? { measured_at: latest.measured_at, received_at: latest.received_at, ...latest.metrics } : null } };
}

function evaluateAlerts(rows, rules = DEFAULT_RULES, { source = 'historical', deviceId = 'lab-01' } = {}) {
  if (!rows.length) return [];
  const activeRules = rules.filter(r => r.enabled), states = new Map(activeRules.map(r => [r.id, { candidate: 0, clear: 0, event: null }])); const events = [];
  const first = rowTime(rows[0]), last = rowTime(rows.at(-1)); let left = 0, right = 0;
  for (let t = first; t <= last; t += 10000) {
    while (right < rows.length && rowTime(rows[right]) <= t) right++;
    while (left < right && rowTime(rows[left]) < t - Math.max(...activeRules.map(r => r.window_seconds || 60), 60) * 1000 - 3000) left++;
    const recent = rows.slice(left, right);
    for (const r of activeRules) {
      const state = states.get(r.id), s = weightedStats(recent, r.metric, t - (r.window_seconds || 60) * 1000, t, { validOnly: true });
      if (s.coverage < .8 || s.mean === null) { state.candidate = 0; state.clear = 0; continue; }
      const high = r.operator === '>' ? s.mean > r.threshold : s.mean >= r.threshold;
      if (!state.event) {
        state.candidate = high ? state.candidate + 10 : 0;
        if (state.candidate >= r.hold_seconds) {
          state.event = { id: `${source}:${deviceId}:${r.id}:${t}`, rule_id: r.id, rule_version: r.version, device_id: deviceId, metric: r.metric, severity: r.severity, status: source === 'historical' ? 'historical' : 'active', started_at: new Date(t).toISOString(), ended_at: null, threshold: r.threshold, value: s.mean, source, acknowledged_at: null, message: `${r.metric} ${r.threshold} ${UNITS[r.metric]} 기준을 ${r.hold_seconds}초 동안 초과` };
          events.push(state.event);
        }
      } else {
        state.event.value = s.mean; state.clear = s.mean < r.clear_threshold ? state.clear + 10 : 0;
        if (state.clear >= r.clear_hold_seconds) { state.event.ended_at = new Date(t).toISOString(); state.event.status = 'resolved'; state.event = null; state.candidate = 0; state.clear = 0; }
      }
    }
  }
  return events;
}

class LiveAlertEngine {
  constructor(deviceId, existing = []) { this.deviceId = deviceId; this.states = new Map(); this.lastTick = null; this.existing = existing; }
  step(rows, rules, now) {
    const tick = Math.floor(now / 10000) * 10000;
    if (this.lastTick !== null && tick <= this.lastTick) return [];
    const consecutive = this.lastTick !== null && tick - this.lastTick <= 10000;
    this.lastTick = tick; const events = [];
    for (const rule of rules) {
      let state = this.states.get(rule.id);
      if (!state) {
        const event = this.existing.find(e => e.rule_id === rule.id && !e.ended_at && e.source === 'live');
        state = { candidate: 0, clear: 0, event: event || null, version: rule.version };
        this.states.set(rule.id, state);
      }
      if (state.version !== rule.version) { state.candidate = 0; state.clear = 0; state.version = rule.version; }
      if (!consecutive) { state.candidate = 0; state.clear = 0; }
      const other = [...this.states.values()].find(s => s !== state && s.event && s.event.metric === rule.metric);
      if (!state.event && other?.event?.severity === 'critical' && rule.severity !== 'critical') { state.candidate = 0; continue; }
      const effective = state.event?.rule_snapshot || rule;
      if (!rule.enabled && !state.event) continue;
      const stats = weightedStats(rows, effective.metric, tick - effective.window_seconds * 1000, tick, { validOnly: true });
      if (stats.coverage < .8 || stats.mean === null) { state.candidate = 0; state.clear = 0; continue; }
      const high = effective.operator === '>' ? stats.mean > effective.threshold : stats.mean >= effective.threshold;
      if (!state.event) {
        // A changed rule starts a new candidate after its update time.
        if (rule.updated_at && tick <= Date.parse(rule.updated_at)) continue;
        state.candidate = high ? state.candidate + 10 : 0;
        if (state.candidate >= effective.hold_seconds) {
          const started = new Date(tick).toISOString();
          state.event = { id: `live:${this.deviceId}:${rule.id}:${tick}`, rule_id: rule.id, rule_version: rule.version, rule_snapshot: { ...rule }, device_id: this.deviceId, metric: rule.metric, severity: rule.severity, status: 'active', started_at: started, ended_at: null, threshold: rule.threshold, value: stats.mean, source: 'live', acknowledged_at: null, message: `${rule.metric} ${rule.threshold} ${UNITS[rule.metric]} 기준을 ${rule.hold_seconds}초 동안 초과` };
          if (other?.event && rule.severity === 'critical') {
            state.event.id = other.event.id; state.event.started_at = other.event.started_at; state.event.escalated_at = started;
            state.event.acknowledged_at = other.event.acknowledged_at; other.event = null; other.candidate = 0; other.clear = 0;
          }
          events.push({ ...state.event });
        }
      } else {
        state.event.value = stats.mean; state.clear = stats.mean < effective.clear_threshold ? state.clear + 10 : 0;
        if (state.clear >= effective.clear_hold_seconds) { state.event.ended_at = new Date(tick).toISOString(); state.event.status = 'resolved'; events.push({ ...state.event }); state.event = null; state.candidate = 0; state.clear = 0; }
        else events.push({ ...state.event });
      }
    }
    return events;
  }
}
module.exports = { METRICS, UNITS, DEFAULT_RULES, numeric, parseTimestamp, parseCsv, classifyQuality, applyFlatQuality, weightedStats, aggregateSeries, analyzeRows, evaluateAlerts, LiveAlertEngine, rowTime, rowValue, rowQuality };
