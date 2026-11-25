'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (value, digits = 0) => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ko-KR', {maximumFractionDigits:digits, minimumFractionDigits:digits});
const date = (value, short = false) => !value || !Number.isFinite(new Date(value).getTime()) ? '수집 안 됨' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit', ...(short ? {} : {year:'numeric'}), hour:'2-digit', minute:'2-digit', ...(short ? {} : {second:'2-digit'}), hour12:false}).format(new Date(value));
const duration = value => value == null ? '—' : value < 60 ? number(value) + '초' : value < 3600 ? number(value / 60, 1) + '분' : number(value / 3600, 1) + '시간';
const icons = {
wind:'<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M4 16h5a3 3 0 1 1-3 3"/>',
grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
chart:'<path d="M4 4v16h17M7 14l4-5 4 3 5-7"/>',
bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
upload:'<path d="M12 16V3M7 8l5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
sensor:'<rect x="6" y="4" width="12" height="16" rx="3"/><path d="M10 8h4M10 12h4M10 16h4M3 7h3M3 17h3M18 7h3M18 17h3"/>',
map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6M9 3v15M15 6v15"/>',
settings:'<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3H9"/><circle cx="12" cy="12" r="3"/>',
user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
menu:'<path d="M3 5h18M3 12h18M3 19h18"/>',
refresh:'<path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5"/>',
close:'<path d="m6 6 12 12M6 18 18 6"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3M12 8v5M12 17h.01"/>',
drop:'<path d="M12 3s-7 7-7 12a7 7 0 0 0 14 0c0-5-7-12-7-12"/>',
thermo:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0M12 7v10"/>',
cloud:'<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6"/>',
arrow:'<path d="M4 12h16M15 7l5 5-5 5"/>',
check:'<path d="m5 12 4 4L19 6"/>',
sound:'<path d="m4 9 5 0 5-4v14l-5-4H4V9M18 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>',
location:'<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="2.5"/>',
download:'<path d="M12 3v13M7 11l5 5 5-5M4 17v4h16v-4"/>'
};
function icon(name) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.info) + '</svg>'; }
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const meta = {
pm25_ugm3:{name:'PM2.5',detail:'초미세먼지',unit:'µg/m³',icon:'wind',digits:0},
co2_ppm:{name:'CO₂',detail:'측정 방식 미확인',unit:'ppm',icon:'cloud',digits:0},
dht_temp_C:{name:'실내 온도',detail:'DHT 대표 센서',unit:'°C',icon:'thermo',digits:1},
dht_humi_pct:{name:'상대습도',detail:'DHT 대표 센서',unit:'%',icon:'drop',digits:1},
am_temp_C:{name:'AM 온도',detail:'보조 센서',unit:'°C',icon:'thermo',digits:1},
am_humi_pct:{name:'AM 습도',detail:'보조 센서',unit:'%',icon:'drop',digits:1},
voc_level:{name:'VOC 원시 단계',detail:'단계 정의 미확인',unit:'단계',icon:'sensor',digits:0}
};
const pages = {
overview:['대시보드','공기질 대시보드','AIR QUALITY OVERVIEW','측정값부터 변화의 원인까지 공간의 공기를 살펴보세요'],
history:['기록 분석','측정 기록 분석','MEASUREMENT HISTORY','조회 기간의 변화와 원시 데이터를 함께 확인하세요'],
alerts:['경고 이력','경고와 처리 이력','ALERT CENTER','관측 경고와 과거 기록의 경고를 구분해 관리하세요'],
import:['데이터 가져오기','측정 데이터 가져오기','DATA IMPORT','아두이노 CSV 기록을 안전하게 검증하고 저장하세요'],
devices:['장치와 센서','장치와 센서 관리','DEVICE MANAGEMENT','설치 공간과 센서 검증 상태를 관리하세요'],
outdoor:['외부 대기질','외부 대기질 비교','OUTDOOR AIR QUALITY','설치 위치의 외부 관측을 실내 센서 데이터와 함께 확인하세요'],
settings:['설정','경고 규칙과 알림 설정','WORKSPACE SETTINGS','경고의 기준과 지속시간을 공간에 맞게 조정하세요']
};
const state = {devices:[], deviceId:'', page:'overview', mode:'historical', period:'all', metric:'pm25_ugm3', dashboard:null, series:null, rules:[], alerts:[], outdoor:null, raw:null, offset:0, controller:null, revision:0, sound:false, audio:null, seenAlerts:new Set(), custom:null};
let toastTimer;
function notify(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'),4000); }
function showError(message, id = '#page-error') { $(id).textContent = message; $(id).hidden = !message; }
function device() { return state.devices.find(d => d.id === state.deviceId) || {}; }
async function api(path, options = {}) {
const response = await fetch(path, {...options, headers:{...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers}});
let payload; try { payload = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다. 서버가 실행 중인지 확인해 주세요.'); }
if (!response.ok) {
  throw Object.assign(new Error(payload.message || payload.error?.message || '요청을 처리할 수 없습니다 (' + response.status + ')'), {
    code: payload.error_code,
    status: response.status
  });
}
return payload;
}
function params(extra = {}) {
const range = getRange();
return new URLSearchParams({device_id:state.deviceId, mode:state.mode, ...range, ...extra}).toString();
}
function getRange() {
if (state.period === 'custom' && state.custom) return state.custom;
const to = state.mode === 'live' ? new Date() : new Date(device().last_measured_at || new Date());
if (!Number.isFinite(to.getTime())) return {};
// Queries are end exclusive; include the last recorded sample.
const end = new Date(to.getTime() + 1);
const from = state.period === 'all' ? new Date(device().first_measured_at || to.getTime() - 365 * 86400000) : new Date(to.getTime() - Number(state.period) * 1000);
return {from:from.toISOString(), to:end.toISOString()};
}
function qualityLabel(q) {
if (Array.isArray(q)) q = q[0];
if (q && typeof q === 'object') q = q.status || q.level;
return ({valid:'검증됨',good:'검증됨',ok:'검증됨',unknown:'정의 미확인',suspect:'점검 필요',flat:'값 고정',missing:'수집 안 됨',invalid:'값 오류',stale:'오래된 값',insufficient:'자료 부족'})[q] || '품질 확인 중';
}
function qualityBadge(q) { const label = qualityLabel(q); return '<span class="badge ' + (label === '검증됨' ? 'green' : label === '점검 필요' || label === '값 고정' ? 'amber' : '') + '">' + label + '</span>'; }
function flatBadge(key) { return state.dashboard?.summary?.flat_channels?.includes(key) ? '<span class="badge amber">기간 내 값 고정 의심</span>' : ''; }
function header(kicker, title, action='') { return '<div class="panel-head"><div><p class="panel-kicker">' + kicker + '</p><h3>' + title + '</h3></div>' + action + '</div>'; }
function rangeText() { const s = state.dashboard?.summary; return s?.start ? date(s.start, true) + ' — ' + date(s.end, true) : '해당 기간의 기록 없음'; }
function summaryValue(key) { const m = state.dashboard?.metrics?.[key] || {}; const v = typeof m.latest === 'object' && m.latest !== null ? m.latest.value : m.latest; return v ?? state.dashboard?.summary?.latest?.metrics?.[key] ?? state.dashboard?.summary?.latest?.[key] ?? null; }
function aiPanel() { return '<div class="ai-card">' + icon('chart') + '<div><strong>AI 예측 준비 단계</strong>검증된 센서 데이터와 학습 모델이 연결되면 예측 경고를 제공합니다. 현재는 관측값과 규칙 기반 경고를 표시합니다.</div></div>'; }
function empty(title='아직 측정 기록이 없습니다', text='CSV 파일을 가져오거나 아두이노 수집 장치를 연결하면 공기질과 시간별 변화가 여기에 표시됩니다.') { return '<section class="empty-state"><div class="empty-symbol">' + icon('sensor') + '</div><h2>' + title + '</h2><p>' + text + '</p><button class="button primary" data-action="import">' + icon('upload') + 'CSV 가져오기</button><a class="button secondary" href="#devices">장치 설정</a></section>'; }
function statusBanner() {
const d = state.dashboard || {}; const summary = d.summary || {}; const active = (d.alerts || []).filter(a => !a.ended_at && ['active','acknowledged'].includes(a.status));
const uncertain = !device().sensor_verified || Object.values(d.metrics || {}).some(m => qualityLabel(m.quality) !== '검증됨');
let title, copy, tone = '', symbol = 'shield';
if (state.mode === 'live' && (!summary.rows || Date.now() - new Date(summary.end).getTime() > 30000)) { title = '실시간 수신을 기다리고 있습니다'; copy = '최근 30초 이내의 유효한 측정값이 없습니다. 아두이노와 수집 에이전트의 연결을 확인하세요.'; }
else if (active.length && state.mode === 'live') { title = '공기질 경고 ' + active.length + '건이 발생했습니다'; copy = active.map(a => a.message || meta[a.metric]?.name + ' 기준 초과').slice(0,2).join(' · '); tone = 'danger'; symbol = 'bell'; }
else if (uncertain) { title = '센서 확인이 필요해 공기질 판정을 보류합니다'; copy = '원시 측정 추이는 확인할 수 있습니다. 고정값과 센서 정의를 점검한 뒤 검증된 채널의 경고를 활성화하세요.'; tone = 'warning'; }
else { title = '측정 데이터가 준비되었습니다'; copy = state.mode === 'historical' ? '선택한 기간의 측정 기록입니다. 과거 경고는 경고 이력에 표시되며 경고음을 울리지 않습니다.' : '최신 측정값과 규칙 기반 경고를 모니터링하고 있습니다.'; }
return '<section class="status-banner ' + tone + '"><div class="status-symbol">' + icon(symbol) + '</div><div class="status-copy"><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(copy) + '</p></div><div class="status-side"><span class="badge blue">' + (state.mode === 'historical' ? '과거 기록 · 알림음 꺼짐' : '실시간 모니터링') + '</span><p class="spaced-small">' + date(summary.end,true) + ' 기준</p></div></section>';
}
function metricCards() { return '<section class="metric-grid" aria-label="주요 공기질 지표">' + ['pm25_ugm3','co2_ppm','dht_temp_C','dht_humi_pct'].map(key => {
const m = state.dashboard?.metrics?.[key] || {}, info = meta[key]; const average = m.mean_60s ?? m.reference_mean_60s;
return '<article class="metric-card"><div class="metric-top"><div class="metric-title"><span class="metric-icon">' + icon(info.icon) + '</span>' + info.name + '</div>' + qualityBadge(m.quality) + '</div><div class="metric-value">' + number(summaryValue(key),info.digits) + '<small>' + info.unit + '</small></div><p class="metric-sub">' + info.detail + '</p><div class="metric-bottom"><span>' + (m.mean_60s == null ? '참고 1분 평균 ' : '1분 평균 ') + number(average,info.digits) + '</span><span>최신 원시값</span></div></article>';
}).join('') + '</section>'; }
function chartPanel() {
const info = meta[state.metric], metric = state.dashboard?.metrics?.[state.metric] || {};
const averageLabel = state.metric === 'voc_level' ? '현재 원시 단계' : '참고 기간 평균';
const averageValue = state.metric === 'voc_level' ? summaryValue('voc_level') : metric.mean ?? metric.reference_mean;
const select = '<select id="metric-select" aria-label="추이 지표 선택">' + Object.entries(meta).map(([key,m]) => '<option value="' + key + '"' + (key === state.metric ? ' selected' : '') + '>' + m.name + '</option>').join('') + '</select>';
return '<section class="panel">' + header('MEASUREMENT TREND','시간별 측정 추이',select) + '<div class="chart-summary"><div>' + averageLabel + '<strong>' + number(averageValue,info.digits) + '<small>' + info.unit + '</small></strong></div><div>최솟값<strong>' + number(metric.min,info.digits) + '</strong></div><div>최댓값<strong>' + number(metric.max,info.digits) + '</strong></div><div>조회 기록<strong>' + number(state.dashboard?.summary?.rows) + '<small>건</small></strong></div></div><div id="chart" class="chart-box">' + renderChart() + '</div><div class="chart-foot"><span><i class="legend-line"></i>' + (state.metric==='voc_level'?'원시 단계':'참고 평균') + '</span><span><i class="legend-range"></i>최소 · 최대</span><span><i class="legend-threshold"></i>설정 기준</span><button class="text-button" id="chart-table-toggle" aria-expanded="false">차트 데이터 표로 보기</button></div><div id="chart-data-table" hidden class="table-scroll detail-table"></div><div class="quality-strip">' + icon('info') + '<span>센서 정의 미확인 값도 원본 그대로 표시합니다. 긴 수집 공백은 선으로 연결하지 않습니다.</span></div></section>';
}
function renderChart() {
const points = state.series?.points || [], info = meta[state.metric];
const getMean = p => p.mean ?? p.reference_mean ?? p.value ?? p.category ?? p.level;
const valid = points.filter(p => getMean(p) != null && Number.isFinite(Number(getMean(p))));
if (!valid.length) return '<div class="chart-empty">' + icon('chart') + '<span>선택한 기간에 표시할 측정값이 없습니다</span></div>';
const W=800,H=270,L=54,R=20,T=22,B=38, maxTime=new Date(state.series.to || getRange().to).getTime(), minTime=new Date(state.series.from || getRange().from).getTime();
const threshold = state.rules.find(r => r.metric === state.metric && r.enabled !== false)?.threshold;
const max = Math.max(...valid.map(p => Number(p.max ?? getMean(p))), Number(threshold) || 0, 1) * 1.12, min = Math.min(0,...valid.map(p => Number(p.min ?? getMean(p)))), span = max-min || 1;
const x = t => L+(new Date(t).getTime()-minTime)/(maxTime-minTime||1)*(W-L-R), y = v => H-B-(Number(v)-min)/span*(H-T-B);
const interval = state.series.interval_seconds || 60, segments=[]; let current=[], prev=null;
for (const point of points) { const mean=getMean(point), t=new Date(point.time || point.timestamp).getTime(); if(mean==null || !Number.isFinite(Number(mean))) { if(current.length) segments.push(current); current=[];prev=null;continue; } if(prev!=null && t-prev>interval*3000){if(current.length)segments.push(current);current=[];} current.push({...point,_mean:Number(mean),_time:point.time||point.timestamp});prev=t; }
if(current.length) segments.push(current);
const n = value => Number(value).toFixed(2);
let svg = '<svg class="timeseries" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+escapeHTML(info.name+' 시간별 변화 '+rangeText()+' 최소 '+number(state.dashboard?.metrics?.[state.metric]?.min)+' 최대 '+number(state.dashboard?.metrics?.[state.metric]?.max))+'">';
svg += '<text x="'+L+'" y="11">'+escapeHTML(info.unit)+'</text>';
for(let i=0;i<5;i++){const value=min+span*i/4, Y=y(value);svg += '<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+n(Y)+'" y2="'+n(Y)+'"/><text text-anchor="end" x="'+(L-12)+'" y="'+n(Y+4)+'">'+number(value,state.metric==='voc_level'?0:Math.abs(value)<10?1:0)+'</text>';}
for(let i=0;i<5;i++){const t=minTime+(maxTime-minTime)*i/4;svg += '<text text-anchor="'+(i===0?'start':i===4?'end':'middle')+'" x="'+n(x(t))+'" y="'+(H-12)+'">'+date(t,true)+'</text>';}
if(threshold!=null){svg += '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+n(y(threshold))+'" y2="'+n(y(threshold))+'" stroke="#c08b31" stroke-dasharray="5 4"/><text x="'+(W-R)+'" y="'+n(y(threshold)-7)+'" text-anchor="end" class="threshold-label">기준 '+number(threshold)+'</text>';}
for(const segment of segments){const upper=segment.map(p=>n(x(p._time))+','+n(y(p.max??p._mean))),lower=segment.slice().reverse().map(p=>n(x(p._time))+','+n(y(p.min??p._mean)));svg += '<polygon points="'+upper.concat(lower).join(' ')+'" fill="#e5edff"/>'; const path=segment.map((p,i)=> !i?'M'+n(x(p._time))+' '+n(y(p._mean)):state.metric==='voc_level'?'H'+n(x(p._time))+'V'+n(y(p._mean)):'L'+n(x(p._time))+' '+n(y(p._mean))).join(' ');svg += '<path d="'+path+'" fill="none" stroke="#4279ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';if(segment.length===1) svg += '<circle cx="'+n(x(segment[0]._time))+'" cy="'+n(y(segment[0]._mean))+'" r="3" fill="#4279ee"/>';}
svg += '</svg>'; return svg;
}
function alertTable(alerts, limit=null) {
const list = limit ? alerts.slice(0,limit) : alerts;
if(!list.length) return '<div class="empty-inline">이 조회 모드에 해당하는 경고가 없습니다</div>';
return '<div class="table-scroll"><table><thead><tr><th>발생 시각</th><th>지표와 원인</th><th>측정 / 기준</th><th>유형</th><th>상태</th><th>처리</th></tr></thead><tbody>' + list.map(a=>'<tr><td>'+date(a.started_at,true)+'<small>'+escapeHTML(device().name || state.deviceId)+'</small></td><td><strong>'+escapeHTML(meta[a.metric]?.name || a.metric || '측정 경고')+'</strong><small>'+escapeHTML(a.message || '설정 기준 초과')+'</small></td><td>'+number(a.value)+' / '+number(a.threshold)+'<small>'+escapeHTML(meta[a.metric]?.unit || '')+'</small></td><td><span class="badge '+(a.source==='live'?'red':'blue')+'">'+(a.source==='live'?'실시간 관측':'과거 기록')+'</span></td><td><span class="badge '+(a.ended_at?'green':a.acknowledged_at?'':'amber')+'">'+(a.ended_at?'해제됨':a.acknowledged_at?'확인됨':'미확인')+'</span>'+ (a.ended_at?'<small>'+date(a.ended_at,true)+'</small>':'')+'</td><td>'+(a.acknowledged_at?'<span class="muted">확인 완료</span>':'<button class="button secondary" data-ack="'+escapeHTML(a.id)+'">확인</button>')+'</td></tr>').join('') + '</tbody></table></div>';
}
function sensorPanel() {
const s=state.dashboard?.summary || {}, metrics=state.dashboard?.metrics || {};
return '<section class="panel">' + header('SENSOR HEALTH','장치와 데이터 품질','<a href="#devices" class="text-button">상세</a>') + '<div class="panel-body"><div class="sensor-list">' + ['pm25_ugm3','co2_ppm','dht_temp_C','dht_humi_pct'].map(key=>'<div class="sensor-row"><div><strong>'+meta[key].name+'</strong><small>결측 '+number(s.missing_by_metric?.[key] ?? 0)+'건</small></div>'+qualityBadge(metrics[key]?.quality)+flatBadge(key)+'</div>').join('') + '</div><div class="data-meta"><div><span>수집 공백</span><strong>'+number(s.gap_count ?? 0)+'개</strong></div><div><span>가장 긴 공백</span><strong>'+duration(s.longest_gap_seconds)+'</strong></div><div><span>마지막 측정</span><strong>'+date(s.end,true)+'</strong></div><div><span>마지막 수신</span><strong>'+date(device().last_received_at,true)+'</strong></div><div><span>장치 부저</span><strong>'+ (device().buzzer_supported?'사용 설정됨':'미사용') +'</strong></div></div>'+((state.dashboard?.quality_events || []).length?'<div class="info-note spaced">'+state.dashboard.quality_events.map(e=>escapeHTML(e.message || e.type)).join('<br>')+'</div>':'')+'</div></section>';
}
function outdoorPanel() {
const data=state.outdoor;
let body;
if(!data) body='<p class="muted">실내 데이터와 별도로 외부 관측을 조회할 수 있습니다</p><div class="outdoor-values"><div class="outdoor-value"><span>외부 PM2.5</span><strong>—</strong><small>µg/m³</small></div><div class="outdoor-value"><span>외부 PM10</span><strong>—</strong><small>µg/m³</small></div></div><button class="button secondary" data-action="outdoor">'+icon('refresh')+'외부 관측 조회</button>';
else { const o=data.observation || {}; body='<div class="outdoor-location">'+icon('location')+'<strong>'+escapeHTML(data.station_name || device().station_name || '측정소 미지정')+'</strong><span class="badge '+(data.stale?'amber':'blue')+'">'+(data.stale?'오래된 관측':'외부 관측')+'</span></div><div class="outdoor-values"><div class="outdoor-value"><span>외부 PM2.5</span><strong>'+number(o.pm25Value)+'</strong><small>µg/m³</small></div><div class="outdoor-value"><span>외부 PM10</span><strong>'+number(o.pm10Value)+'</strong><small>µg/m³</small></div></div><p class="muted">'+escapeHTML(o.dataTime || data.message || '관측값 없음')+'</p>'; }
return '<section class="panel">'+header('OUTDOOR REFERENCE','외부 대기질','<a href="#outdoor" class="text-button">자세히</a>')+'<div class="panel-body">'+body+'<div class="info-note spaced">에어코리아 공공 측정소 기준의 참고 정보입니다. 실내 센서와 위치 및 관측 시각이 다릅니다.</div></div></section>';
}
function overview() { if(!state.dashboard?.summary?.rows) return statusBanner()+empty()+aiPanel(); return statusBanner()+metricCards()+'<div class="content-grid"><div>'+chartPanel()+'<section class="panel">'+header('ALERT LOG','경고 이력','<a href="#alerts" class="text-button">전체 보기 '+icon('arrow')+'</a>')+alertTable(state.dashboard.alerts || [],5)+'</section><section class="panel">'+header('ADDITIONAL CHANNELS','보조 센서와 원시 단계')+'<div class="panel-body sensor-list">'+['am_temp_C','am_humi_pct','voc_level'].map(key=>'<div class="sensor-row"><div><strong>'+meta[key].name+'</strong><small>'+meta[key].detail+'</small></div><strong>'+number(summaryValue(key),meta[key].digits)+' '+meta[key].unit+'</strong>'+qualityBadge(state.dashboard.metrics?.[key]?.quality)+flatBadge(key)+'</div>').join('')+'</div></section></div><div class="aside-panels">'+outdoorPanel()+sensorPanel()+aiPanel()+'</div></div>'; }
function history() { if(!state.dashboard?.summary?.rows) return empty('해당 기간에 기록이 없습니다','전체 기록을 선택하거나 CSV를 가져와 측정 기록을 확인하세요.'); const s=state.dashboard.summary;return '<div class="stat-grid">'+[['조회 기록',number(s.rows)+'건','원본 측정값'],['조회 기간',duration((new Date(s.end)-new Date(s.start))/1000),rangeText()],['긴 수집 공백',number(s.gap_count)+'개','최장 '+duration(s.longest_gap_seconds)],['지표 수','7개','DHT · AM · CO₂ · VOC · PM2.5']].map(a=>'<div class="stat-box"><span>'+a[0]+'</span><strong>'+a[1]+'</strong><small>'+a[2]+'</small></div>').join('')+'</div>'+chartPanel()+'<section class="panel">'+header('RAW MEASUREMENTS','원시 측정 기록','<a class="button secondary" href="/api/v1/export?'+params()+'">'+icon('download')+'CSV 내보내기</a>')+rawTable()+'</section>'+qualityTable(); }
function rawTable() { if(!state.raw) return '<div class="empty-inline">원시 기록을 불러오는 중</div>'; const rows=state.raw.rows || [];return '<div class="table-scroll"><table><thead><tr><th>측정 시각</th>'+Object.values(meta).map(m=>'<th>'+m.name+'<br>'+m.unit+'</th>').join('')+'<th>출처</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+date(r.measured_at || r.timestamp)+'</td>'+Object.entries(meta).map(([k,m])=>'<td>'+number(r.metrics?.[k] ?? r[k],m.digits)+'</td>').join('')+'<td><span class="badge">'+escapeHTML(r.source || 'CSV')+'</span></td></tr>').join('')+'</tbody></table></div><div class="pagination"><span>'+number(state.offset+1)+' — '+number(Math.min(state.offset+rows.length,state.raw.total))+' / '+number(state.raw.total)+'건</span><div><button class="button secondary" data-action="raw-prev"'+(state.offset===0?' disabled':'')+'>이전</button><button class="button secondary" data-action="raw-next"'+(state.offset+rows.length>=state.raw.total?' disabled':'')+'>다음</button></div></div>'; }
function qualityTable() { const s=state.dashboard?.summary || {}; return '<section class="panel">'+header('DATA QUALITY','채널별 품질 상세')+'<div class="table-scroll quality-table"><table><thead><tr><th>지표</th><th>상태</th><th>결측</th><th>범위</th><th>확인 사항</th></tr></thead><tbody>'+Object.entries(meta).map(([key,m])=>{const q=state.dashboard?.metrics?.[key]||{};return '<tr><td><strong>'+m.name+'</strong><small>'+m.unit+'</small></td><td>'+qualityBadge(q.quality)+flatBadge(key)+'</td><td>'+number(s.missing_by_metric?.[key] ?? 0)+'건</td><td>'+number(q.min,m.digits)+' — '+number(q.max,m.digits)+'</td><td>'+escapeHTML((q.quality_reasons || []).map(r=>typeof r==='string'?r:r.message).join(' · ') || m.detail)+(s.flat_channels?.includes(key)?'<small>조회 기간에 30분 이상 CO₂와 AM 온습도가 함께 고정된 구간이 있습니다</small>':'')+'</td></tr>';}).join('')+'</tbody></table></div></section>'; }
function alertsView() { return '<div class="notice"><strong>'+ (state.mode==='historical'?'과거 기록의 경고 이력':'실시간 관측 경고')+'</strong><br>'+ (state.mode==='historical'?'CSV 경고는 기록 분석용 이벤트입니다. 실제 알림음과 아두이노 부저는 발생시키지 않습니다.':'알림음은 직접 활성화한 경우 새 실시간 경고에만 울립니다.')+'</div><section class="panel">'+header('OBSERVED ALERTS','경고 이벤트','<button class="button secondary" data-action="sound">'+icon('sound')+(state.sound?'경고음 끄기':'경고음 활성화')+'</button>')+alertTable(state.alerts)+'</section>'+aiPanel(); }
function csvProvenance(entry) {
  const counts = [
    ['저장', entry.accepted], ['중복', entry.duplicates],
    ['충돌', entry.conflicts], ['오류', entry.invalid]
  ].map(([label, count]) => label + ' ' + number(count)).join(' · ');
  const hash = entry.file_hash
    ? '<code class="revision-hash">' + escapeHTML(entry.file_hash) + '</code>'
    : '기록 없음';
  return '<details class="csv-provenance"><summary>CSV 출처 보기</summary><dl class="csv-provenance-meta">'
    + '<div><dt>UTF-8 입력 SHA-256</dt><dd>' + hash + '</dd></div>'
    + '<div><dt>입력 시간대</dt><dd>' + escapeHTML(entry.timezone || '기록 없음') + '</dd></div>'
    + '<div><dt>처리 건수</dt><dd>' + counts + '</dd></div></dl></details>';
}
function importsView() { const imports=state.dashboard?.imports || []; return '<section class="empty-state"><div class="empty-symbol">'+icon('upload')+'</div><h2>아두이노 기록을 대시보드로 연결하세요</h2><p>파일 선택 후 측정 기간과 결측 및 중복을 검증합니다. 확인한 데이터만 선택한 장치에 저장합니다.</p><button class="button primary" data-action="import">'+icon('upload')+'CSV 파일 가져오기</button></section><div class="notice"><strong>읽기 실패와 결측은 0으로 채우지 않습니다</strong><br>동일 장치와 시각의 같은 값은 중복으로 건너뛰고 서로 다른 값은 충돌로 분리합니다. 원본값을 자동 덮어쓰지 않습니다.</div><section class="panel">'+header('IMPORT HISTORY','최근 가져오기 이력')+(imports.length?'<div class="table-scroll"><table><thead><tr><th>파일</th><th>등록 시각</th><th>저장 기록</th><th>기록 기간</th></tr></thead><tbody>'+imports.map(i=>'<tr><td><strong>'+escapeHTML(i.filename || i.original_filename || i.id)+'</strong>'+csvProvenance(i)+'</td><td>'+date(i.created_at)+'</td><td>'+number(i.accepted ?? i.valid_rows ?? i.rows)+'건</td><td>'+date(i.start,true)+' — '+date(i.end,true)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty-inline">등록된 가져오기 이력이 없습니다</div>')+'</section>'; }
function newDevicePanel(){return '<section class="panel">'+header('ADD A DEVICE','새 측정 장치 등록')+'<form id="new-device-form" class="form-panel"><div class="form-grid"><label>장치 ID<input name="id" pattern="[a-zA-Z0-9_-]{1,64}" placeholder="예 classroom-02" required maxlength="64"><small class="muted">영문과 숫자 및 하이픈과 밑줄 사용</small></label><label>장치 이름<input name="name" placeholder="예 2학년 교실 센서" required maxlength="100"></label><label>설치 공간<input name="room" placeholder="예 본관 201호" maxlength="100"></label></div><div class="form-actions"><button class="button primary" type="submit">새 장치 등록</button></div></form></section>';}
function devicesView() { const d=device();return '<div class="device-grid"><section class="panel">'+header('DEVICE PROFILE','장치 정보')+'<form id="device-form" class="form-panel"><div class="form-grid"><label>장치 ID<input value="'+escapeHTML(d.id)+'" disabled></label><label>장치 이름<input name="name" value="'+escapeHTML(d.name)+'" required maxlength="100"></label><label>설치 공간<input name="room" value="'+escapeHTML(d.room)+'" maxlength="100"></label><label>외부 측정소<input name="station_name" value="'+escapeHTML(d.station_name)+'" placeholder="예 종로구" maxlength="100"></label><label>위도<input name="lat" type="number" step="any" min="-90" max="90" value="'+escapeHTML(d.lat ?? '')+'"></label><label>경도<input name="lon" type="number" step="any" min="-180" max="180" value="'+escapeHTML(d.lon ?? '')+'"></label><label class="checkbox-label"><input name="sensor_verified" type="checkbox" '+(d.sensor_verified?'checked':'')+'>센서 모델과 측정 단위 및 정상 동작을 확인했습니다</label><label class="checkbox-label"><input name="buzzer_supported" type="checkbox" '+(d.buzzer_supported?'checked':'')+'><span>부저 연결됨<small class="hardware-help">부저와 명령 조회 API를 처리하는 장치 펌웨어를 연결한 경우에만 활성화하세요. 새 실시간 경고에만 명령을 보냅니다.</small></span></label></div><div class="form-actions"><button class="button primary" type="submit">장치 설정 저장</button></div></form></section><div>'+sensorPanel()+'<div class="notice"><strong>센서 확인 후 검증 상태를 변경하세요</strong><br>CO₂가 실측인지 eCO₂인지 확인하고 VOC 단계의 의미를 기록하세요. 고정값이 반복되는 센서는 읽기 성공 여부를 점검해야 합니다. GPS는 설치 위치를 관리하는 선택 정보입니다.</div></div></div>'+qualityTable()+newDevicePanel(); }
const ruleFields = {
  enabled: '사용 상태',
  threshold: '발생 기준',
  hold_seconds: '지속시간',
  clear_threshold: '해제 기준',
  window_seconds: '평균 구간',
  clear_hold_seconds: '해제 지속시간'
};

function ruleName(rule) {
  const name = meta[rule.metric]?.name || rule.metric || rule.id || '경고 규칙';
  const severity = ({ warning: '주의', critical: '경고' })[rule.severity];
  return severity ? name + ' · ' + severity : name;
}

function ruleFieldValue(rule, field) {
  const value = rule[field];
  if (value == null) return '—';
  if (field === 'enabled') return value ? '사용' : '사용 안 함';
  const unit = field.endsWith('_seconds') ? '초' : meta[rule.metric]?.unit || '';
  return String(value) + (unit ? ' ' + unit : '');
}

function ruleDiff(before, after) {
  const changes = Object.entries(ruleFields).filter(([field]) => before[field] !== after[field]);
  if (!changes.length) return '';
  const rows = changes.map(([field, label]) =>
    '<tr><th scope="row">' + label + '</th><td>' + escapeHTML(ruleFieldValue(before, field))
    + '</td><td>' + escapeHTML(ruleFieldValue(after, field)) + '</td></tr>'
  ).join('');
  return '<table class="rule-diff" aria-label="규칙 변경 전후 비교"><thead><tr>'
    + '<th scope="col">항목</th><th scope="col">변경 전</th><th scope="col">변경 후</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function ruleHistory() {
  const audit = state.ruleAudit;
  if (!audit || audit.unavailable) {
    return '<section class="panel">' + header('RULE HISTORY', '변경 이력')
      + '<p class="empty-inline">변경 이력을 불러오지 못했습니다.</p></section>';
  }
  const statuses = {
    empty: ['로컬 해시 기록 없음', ''],
    verified: ['로컬 해시 일치', 'green'],
    mismatch: ['로컬 해시 불일치', 'red']
  };
  const [status, statusClass] = statuses[audit.integrity] || ['로컬 해시 확인 불가', 'amber'];
  const entries = audit.entries || [];
  const badge = '<span class="badge ' + statusClass + '" role="status">' + status + '</span>';
  const items = entries.map(entry => {
    const before = entry.before || {};
    const after = entry.after || {};
    return '<details class="revision-entry"><summary><strong>' + escapeHTML(ruleName(after))
      + '</strong><span class="badge revision-version">v' + escapeHTML(before.version ?? '—')
      + ' → v' + escapeHTML(after.version ?? '—') + '</span>'
      + '<time datetime="' + escapeHTML(entry.changed_at) + '">' + escapeHTML(date(entry.changed_at))
      + '</time></summary><div class="revision-detail"><p class="revision-reason">'
      + escapeHTML(entry.reason || '사유 기록 없음') + '</p><div class="table-scroll">'
      + ruleDiff(before, after) + '</div><dl class="revision-meta">'
      + '<div><dt>이전 해시</dt><dd><code class="revision-hash">' + escapeHTML(entry.previous_hash || '—')
      + '</code></dd></div><div><dt>기록 해시</dt><dd><code class="revision-hash">'
      + escapeHTML(entry.entry_hash || '—') + '</code></dd></div></dl></div></details>';
  }).join('');
  return '<section class="panel" id="rule-history">' + header('RULE HISTORY', '변경 이력', badge)
    + '<div class="panel-body"><p class="muted">최근 ' + number(entries.length) + '건 · 전체 '
    + number(audit.total) + '건</p>'
    + (items ? '<div class="revision-list">' + items + '</div>'
      : '<p class="empty-inline">아직 저장된 규칙 변경이 없습니다.</p>')
    + '</div></section>';
}

function settingsView() {return '<section class="panel">'+header('NOTIFICATION PREFERENCES','브라우저 경고음')+'<div class="panel-body"><button class="button secondary" data-action="sound">'+icon('sound')+(state.sound?'경고음 끄기':'경고음 활성화')+'</button><span class="sound-note">'+(state.sound?'새로운 실시간 경고가 발생하면 소리를 재생합니다':'사용자가 활성화해야 경고음이 재생됩니다')+'</span></div></section><section class="panel">'+header('ALERT RULES','관측 경고 규칙')+'<div class="panel-body"><p class="muted spaced-bottom">설정값은 운영 경고의 기준입니다. 센서 품질과 지속시간을 함께 판단하며 의학적 기준값으로 간주하지 않습니다.</p><div class="rules">'+state.rules.map(r=>'<form class="rule-row" data-rule="'+escapeHTML(r.id)+'" data-version="'+escapeHTML(r.version)+'"><div class="rule-title">'+escapeHTML(meta[r.metric]?.name || r.metric)+'<small>'+escapeHTML(meta[r.metric]?.unit || '')+' · '+escapeHTML(({warning:'주의',critical:'경고'})[r.severity] || r.severity || '경고')+' · v'+escapeHTML(r.version ?? '—')+'</small><label><input type="checkbox" name="enabled" '+(r.enabled?'checked':'')+'>사용</label></div><label>발생 기준 '+ (r.operator==='>='?'≥':r.operator==='>'?'&gt;':escapeHTML(r.operator || '&gt;')) +'<input name="threshold" type="number" step="any" min="0" value="'+escapeHTML(r.threshold)+'" required></label><label>지속시간 초<input name="hold_seconds" type="number" min="10" value="'+escapeHTML(r.hold_seconds ?? 60)+'" required></label><label>해제 기준<input name="clear_threshold" type="number" step="any" min="0" value="'+escapeHTML(r.clear_threshold ?? r.threshold)+'" required></label><button class="button primary rule-review-button" type="submit">변경 검토</button><details class="rule-details"><summary>평균 구간과 해제 지속시간</summary><div class="rule-detail-fields"><label>평균 구간 초<input name="window_seconds" type="number" min="10" max="86400" value="'+escapeHTML(r.window_seconds ?? 60)+'" required></label><label>해제 지속시간 초<input name="clear_hold_seconds" type="number" min="10" max="86400" value="'+escapeHTML(r.clear_hold_seconds ?? 300)+'" required></label></div></details></form>').join('')+'</div></div></section><div class="notice"><strong>규칙은 센서 검증 후 적용됩니다</strong><br>설정 변경은 앞으로 들어오는 측정값에 적용됩니다. 장치의 검증 상태와 채널 품질이 확인되지 않으면 원시 추이만 보여주고 경고 판정을 보류합니다.</div>'+ruleHistory()+aiPanel(); }
function outdoorView() {return '<div class="device-grid"><div>'+outdoorPanel()+'</div><section class="panel">'+header('LOCATION CONTEXT','실내외 비교 기준')+'<div class="panel-body"><div class="sensor-list"><div class="sensor-row"><strong>설치 공간</strong><span>'+escapeHTML(device().room || '미지정')+'</span></div><div class="sensor-row"><strong>장치 좌표</strong><span>'+ (device().lat != null && device().lon != null?number(device().lat,4)+', '+number(device().lon,4):'등록 안 됨')+'</span></div><div class="sensor-row"><strong>센서 PM2.5</strong><span>'+number(summaryValue('pm25_ugm3'))+' µg/m³</span></div><div class="sensor-row"><strong>센서 측정 시각</strong><span>'+date(state.dashboard?.summary?.end,true)+'</span></div></div><div class="info-note spaced">과거 CSV와 현재 외부 관측은 같은 시각의 비교가 아닙니다. 환기 권고와 실내외 차이 계산은 동시 관측 및 검증된 센서가 준비된 뒤 제공합니다.</div><a href="#devices" class="button secondary spaced">측정소와 위치 설정</a></div></section></div>'; }
function render() {
const page=pages[state.page];$('#breadcrumb-page').textContent=page[0];$('#page-title').textContent=page[1];$('#page-eyebrow').textContent=page[2];$('#page-description').textContent=page[3];
document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===state.page);a.setAttribute('aria-current',a.dataset.page===state.page?'page':'false');});
$('#historical-mode').setAttribute('aria-pressed',state.mode==='historical');$('#live-mode').setAttribute('aria-pressed',state.mode==='live');
$('#range-label').textContent=rangeText();$('#sample-label').textContent=number(state.dashboard?.summary?.rows ?? 0)+'건 · '+(state.mode==='historical'?'과거 기록':'실시간 측정');
const count=(state.dashboard?.alerts || []).filter(a=>!a.acknowledged_at && !a.ended_at).length;$('#alert-count').hidden=!count;$('#alert-count').textContent=count;
const views={overview,history,alerts:alertsView,import:importsView,devices:devicesView,outdoor:outdoorView,settings:settingsView};
$('#view').innerHTML=views[state.page]();hydrateIcons($('#view'));
}
async function loadDevices(signal) {
const result=await api('/api/v1/devices',{signal});state.devices=result.devices || [];
if(!state.devices.some(d=>d.id===state.deviceId))state.deviceId=state.devices[0]?.id || '';
for(const id of ['#device-select','#import-device']){$(id).innerHTML=state.devices.length?state.devices.map(d=>'<option value="'+escapeHTML(d.id)+'">'+escapeHTML(d.name || d.id)+(d.room?' · '+escapeHTML(d.room):'')+'</option>').join(''):'<option value="">등록된 장치 없음</option>';$(id).value=state.deviceId;}
}
async function load(silent=false) {
state.controller?.abort(); const controller=new AbortController();state.controller=controller;const revision=++state.revision;
if(!silent)$('#page-loading').hidden=false;showError('');
try {
await loadDevices(controller.signal);
if(!state.deviceId){state.dashboard=null;render();return;}
const requests=[api('/api/v1/dashboard?'+params(),{signal:controller.signal}),api('/api/v1/series?'+params({metric:state.metric,interval:'auto'}),{signal:controller.signal}),api('/api/v1/alert-rules',{signal:controller.signal})];
if(state.page==='alerts')requests.push(api('/api/v1/alerts?'+params(),{signal:controller.signal}));
if(state.page==='history')requests.push(api('/api/v1/measurements?'+params({limit:20,offset:state.offset}),{signal:controller.signal}));
if (state.page === 'settings') {
  requests.push(api('/api/v1/alert-rule-revisions', {signal: controller.signal}).catch(error => {
    if (error.name === 'AbortError') throw error;
    return {unavailable: true};
  }));
}
const results=await Promise.all(requests);if(revision!==state.revision)return;
[state.dashboard,state.series]=results;state.rules=results[2].rules || [];
if(state.page==='alerts')state.alerts=results[3].alerts || [];if(state.page==='history')state.raw=results[3];
if (state.page === 'settings') state.ruleAudit = results[3];
$('#connection-status').className='connection-status ready';$('#connection-status').innerHTML='<i></i>'+ (state.mode==='historical'?'기록 데이터 연결됨':'10초마다 자동 갱신');
render();checkNewAlerts();
if(state.page==='outdoor' && !state.outdoor)await loadOutdoor();
} catch(error) {if(error.name==='AbortError')return;$('#connection-status').className='connection-status';$('#connection-status').innerHTML='<i></i>연결 오류';showError(error.message);if(!state.dashboard)$('#view').innerHTML=empty('데이터에 연결할 수 없습니다','서버 연결을 확인한 뒤 새로고침해 주세요. 측정 기록이 준비되면 CSV 파일을 가져올 수 있습니다.');}
finally {if(revision===state.revision)$('#page-loading').hidden=true;}
}
async function loadOutdoor() { const id=state.deviceId;try{const data=await api('/api/v1/outdoor?'+params());if(id!==state.deviceId)return;state.outdoor=data;render();}catch(e){showError(e.message);} }
function alertSoundKey(alert) { return alert.id + ':' + alert.severity; }
function checkNewAlerts(latest = state.dashboard?.alerts) { const alerts=(latest || []).filter(a=>a.source==='live' && !a.ended_at && a.status==='active');for(const a of alerts){const key=alertSoundKey(a);if(state.sound && state.mode==='live' && !state.seenAlerts.has(key))playSound();state.seenAlerts.add(key);} }
function playSound(){if(!state.audio || state.audio.state!=='running')return;const o=state.audio.createOscillator(),g=state.audio.createGain();o.type='sine';o.frequency.value=680;g.gain.setValueAtTime(.08,state.audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,state.audio.currentTime+.6);o.connect(g);g.connect(state.audio.destination);o.start();o.stop(state.audio.currentTime+.6);}
async function toggleSound(){if(state.sound){state.sound=false;render();notify('경고음을 껐습니다');return;}const Audio=window.AudioContext || window.webkitAudioContext;if(!Audio){notify('이 브라우저는 소리 알림을 지원하지 않습니다');return;}try{state.audio=state.audio || new Audio();await state.audio.resume();state.sound=true;for(const a of state.dashboard?.alerts || [])state.seenAlerts.add(alertSoundKey(a));render();notify('경고음 활성화 · 앞으로 발생하는 실시간 경고에만 적용됩니다');}catch{notify('소리 재생을 활성화할 수 없습니다. 브라우저 권한을 확인하세요');}}
function openImport(){showError('','#import-error');$('#import-dialog').showModal();}
function resetValidation(){state.importRevision=(state.importRevision || 0)+1;state.importToken=null;$('#commit-import').hidden=true;$('#validate-import').hidden=false;$('#import-result').innerHTML='';$('#step-preview').classList.remove('active');$('#step-save').classList.remove('active');$('#step-file').classList.add('active');}
function validationChannelNotes(result){const channels=Object.entries(meta).filter(([key])=>(result.missing_by_metric?.[key]||0)+(result.invalid_by_metric?.[key]||0)>0);return channels.length?'<div class="notice spaced"><strong>채널별 결측과 숫자 오류</strong><br>'+channels.map(([key,m])=>escapeHTML(m.name)+' 결측 '+number(result.missing_by_metric?.[key]||0)+'건 · 숫자 오류 '+number(result.invalid_by_metric?.[key]||0)+'건').join('<br>')+'<br>해당 값은 null로 보존하며 정상값으로 채우지 않습니다.</div>':'';}
async function validateImport(){const revision=state.importRevision || 0;const file=$('#csv-file').files[0];if(!file)return;if(file.size>20*1024*1024){showError('20 MB 이하의 CSV 파일을 선택해 주세요','#import-error');return;}const button=$('#validate-import');button.disabled=true;button.textContent='전체 파일 검증 중';showError('','#import-error');try{const csv=await file.text(),result=await api('/api/v1/imports/validate',{method:'POST',body:JSON.stringify({csv,filename:file.name,device_id:$('#import-device').value,timezone:$('#import-timezone').value})});if(revision!==(state.importRevision || 0))return;state.importToken=result.validation_token;$('#step-file').classList.remove('active');$('#step-preview').classList.add('active');$('#import-result').innerHTML='<div class="import-result-grid">'+[['읽은 행',result.rows],['유효 행',result.valid_rows],['중복',result.duplicates],['충돌 / 오류',(result.conflicts||0)+(result.invalid||0)]].map(a=>'<div>'+a[0]+'<strong>'+number(a[1])+'</strong></div>').join('')+'</div><p class="muted">측정 기간 '+date(result.start,true)+' — '+date(result.end,true)+'</p>'+validationChannelNotes(result)+(result.warnings?.length?'<div class="notice spaced">'+result.warnings.map(w=>escapeHTML(typeof w==='string'?w:w.message)).join('<br>')+'</div>':'')+'<h3 class="subheading">미리보기</h3><div class="table-scroll"><table><thead><tr><th>측정 시각</th>'+Object.values(meta).map(m=>'<th>'+m.name+'</th>').join('')+'</tr></thead><tbody>'+(result.preview || []).slice(0,20).map(r=>'<tr><td>'+escapeHTML(r.timestamp || date(r.measured_at))+'</td>'+Object.entries(meta).map(([k,m])=>'<td>'+number(r[k] ?? r.metrics?.[k],m.digits)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';$('#validate-import').hidden=true;$('#commit-import').hidden=false;$('#commit-import').disabled=!result.validation_token || !result.valid_rows;}catch(e){showError(e.message,'#import-error');}finally{button.disabled=false;button.textContent='파일 검증';}}
async function commitImport(){const button=$('#commit-import');button.disabled=true;button.textContent='기록 저장 중';try{const r=await api('/api/v1/imports/commit',{method:'POST',body:JSON.stringify({validation_token:state.importToken})});state.deviceId=$('#import-device').value;state.mode='historical';state.period='all';$('#period-select').value='all';$('#step-preview').classList.remove('active');$('#step-save').classList.add('active');$('#import-result').innerHTML='<div class="success-note">'+icon('check')+' '+number(r.accepted)+'건을 저장했습니다. 중복 '+number(r.duplicates)+'건 · 충돌 '+number(r.conflicts)+'건 · 오류 '+number(r.invalid)+'건</div>';button.hidden=true;state.importToken=null;await load();notify('CSV 기록이 저장되었습니다');}catch(e){showError(e.message,'#import-error');}finally{button.disabled=false;button.textContent='검증 데이터 저장';}}
document.addEventListener('click',async event=>{
const ack=event.target.closest('[data-ack]');if(ack){ack.disabled=true;try{await api('/api/v1/alerts/'+encodeURIComponent(ack.dataset.ack)+'/ack',{method:'POST',body:JSON.stringify({})});await load(true);notify('경고를 확인 처리했습니다');}catch(e){showError(e.message);ack.disabled=false;}return;}
const action=event.target.closest('[data-action]')?.dataset.action;
if(action==='import')openImport();if(action==='outdoor')await loadOutdoor();if(action==='sound')await toggleSound();if(action==='raw-prev'||action==='raw-next'){state.offset=Math.max(0,state.offset+(action==='raw-next'?20:-20));await load(true);}
if(event.target.closest('#chart-table-toggle')){const el=$('#chart-data-table');el.hidden=!el.hidden;$('#chart-table-toggle').setAttribute('aria-expanded',!el.hidden);if(!el.hidden){const m=meta[state.metric];el.innerHTML='<table><thead><tr><th>시각</th><th>'+(state.metric==='voc_level'?'원시 단계 ':'참고 평균 ')+m.unit+'</th><th>최소</th><th>최대</th><th>품질</th></tr></thead><tbody>'+(state.series?.points || []).filter(p=>(p.mean??p.reference_mean??p.value??p.category??p.level)!=null).slice(0,100).map(p=>'<tr><td>'+date(p.time)+'</td><td>'+number(p.mean??p.reference_mean??p.value??p.category??p.level,m.digits)+'</td><td>'+number(p.min,m.digits)+'</td><td>'+number(p.max,m.digits)+'</td><td>'+qualityLabel(p.quality)+'</td></tr>').join('')+'</tbody></table><p class="muted table-note">최대 100개 집계 구간 표시 · 전체 원시는 기록 분석에서 내보내세요</p>';}}
});
document.addEventListener('change',event=>{if(event.target.id==='metric-select'){state.metric=event.target.value;load(true);}});
document.addEventListener('submit',async event=>{
if(event.target.id==='new-device-form'){event.preventDefault();const form=event.target,values=new FormData(form),button=$('button',form);button.disabled=true;try{const added=await api('/api/v1/devices',{method:'POST',body:JSON.stringify({id:values.get('id'),name:values.get('name'),room:values.get('room')})});state.deviceId=added.id;state.outdoor=null;await load(true);notify('새 장치를 등록했습니다');}catch(e){showError(e.message);button.disabled=false;}}

if(event.target.id==='device-form'){event.preventDefault();const form=event.target,values=new FormData(form);const data={name:values.get('name'),room:values.get('room'),station_name:values.get('station_name'),sensor_verified:values.has('sensor_verified'),buzzer_supported:values.has('buzzer_supported'),lat:values.get('lat')===''?null:Number(values.get('lat')),lon:values.get('lon')===''?null:Number(values.get('lon'))};const button=$('button[type=submit]',form);button.disabled=true;try{await api('/api/v1/devices/'+encodeURIComponent(state.deviceId),{method:'PATCH',body:JSON.stringify(data)});state.outdoor=null;await load(true);notify('장치 설정을 저장했습니다');}catch(e){showError(e.message);button.disabled=false;}}
const rule = event.target.closest('[data-rule]');
if (rule) {
  event.preventDefault();
  openRuleReview(rule);
}
});

let ruleReview = null;

function openRuleReview(form) {
  const before = state.rules.find(rule => rule.id === form.dataset.rule);
  if (!before) return;
  const values = new FormData(form);
  const changes = Object.fromEntries(Object.keys(ruleFields).map(field => [
    field, field === 'enabled' ? values.has(field) : Number(values.get(field))
  ]));
  const diff = ruleDiff(before, {...before, ...changes});
  showError('');
  if (!diff) {
    notify('변경된 항목이 없습니다');
    return;
  }
  ruleReview = {before, changes, busy: false, stale: false};
  $('#rule-review-summary').textContent = ruleName(before) + ' · 현재 버전 v' + before.version;
  $('#rule-review-diff').innerHTML = diff;
  $('#rule-change-reason').value = '';
  $('#rule-change-reason').setCustomValidity('');
  $('#rule-review-apply').disabled = false;
  showError('', '#rule-review-error');
  $('#rule-review-dialog').showModal();
  $('#rule-change-reason').focus();
}

async function applyRuleReview(event) {
  event.preventDefault();
  const review = ruleReview;
  if (!review || review.busy || review.stale) return;
  const input = $('#rule-change-reason');
  const reason = input.value.trim();
  if (!reason) {
    input.setCustomValidity('변경 사유를 입력해 주세요.');
    input.reportValidity();
    return;
  }
  const apply = $('#rule-review-apply');
  const cancel = $('#rule-review-cancel');
  review.busy = true;
  apply.disabled = true;
  cancel.disabled = true;
  showError('', '#rule-review-error');
  try {
    await api('/api/v1/alert-rules/' + encodeURIComponent(review.before.id), {
      method: 'PUT',
      body: JSON.stringify({...review.changes, expected_version: review.before.version, reason})
    });
    $('#rule-review-dialog').close();
    await load(true);
    notify('경고 규칙과 변경 이력을 저장했습니다');
  } catch (error) {
    review.stale = error.code === 'RULE_VERSION_CONFLICT';
    showError(review.stale
      ? error.message + ' 취소하면 최신 설정을 불러옵니다.'
      : error.message, '#rule-review-error');
  } finally {
    review.busy = false;
    apply.disabled = review.stale;
    cancel.disabled = false;
  }
}

$('#rule-review-form').addEventListener('submit', applyRuleReview);
$('#rule-change-reason').addEventListener('input', event => event.target.setCustomValidity(''));
$('#rule-review-cancel').addEventListener('click', () => $('#rule-review-dialog').close());
$('#rule-review-dialog').addEventListener('cancel', event => {
  if (ruleReview?.busy) event.preventDefault();
});
$('#rule-review-dialog').addEventListener('close', () => {
  const stale = ruleReview?.stale;
  ruleReview = null;
  if (stale && state.page === 'settings') load(true);
});
$('#device-select').addEventListener('change',()=>{state.deviceId=$('#device-select').value;state.outdoor=null;state.offset=0;load();});
$('#period-select').value='all';
$('#period-select').addEventListener('change',()=>{state.period=$('#period-select').value;state.offset=0;$('#custom-range').hidden=state.period!=='custom';if(state.period!=='custom')load();});
$('#custom-range').addEventListener('submit',event=>{event.preventDefault();const from=new Date($('#range-from').value+':00+09:00'),to=new Date($('#range-to').value+':00+09:00');if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to){showError('시작 시각보다 늦은 종료 시각을 선택하세요');return;}state.custom={from:from.toISOString(),to:to.toISOString()};load();});
$('#historical-mode').addEventListener('click',()=>{state.mode='historical';state.offset=0;load();});
$('#live-mode').addEventListener('click',()=>{state.mode='live';state.period='900';state.offset=0;$('#period-select').value='900';$('#custom-range').hidden=true;load();});
$('#refresh-button').addEventListener('click',()=>{state.outdoor=null;load();});
$('#open-import').addEventListener('click',openImport);$('#close-import').addEventListener('click',()=>$('#import-dialog').close());
$('#csv-file').addEventListener('change',()=>{resetValidation();showError('','#import-error');const file=$('#csv-file').files[0];$('#file-name').textContent=file?file.name:'측정 CSV 파일을 선택하세요';$('#validate-import').disabled=!file;});
$('#import-device').addEventListener('change',resetValidation);$('#import-timezone').addEventListener('change',resetValidation);
$('#validate-import').addEventListener('click',validateImport);$('#commit-import').addEventListener('click',commitImport);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#sidebar').classList.remove('open');$('#menu-button').setAttribute('aria-expanded',false);$('#menu-button').setAttribute('aria-label','메뉴 열기');}});
$('#menu-button').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open');$('#menu-button').setAttribute('aria-expanded',open);$('#menu-button').setAttribute('aria-label',open?'메뉴 닫기':'메뉴 열기');});
function navigate(){const target=location.hash.slice(1);state.page=pages[target]?target:'overview';$('#sidebar').classList.remove('open');$('#menu-button').setAttribute('aria-expanded',false);$('#menu-button').setAttribute('aria-label','메뉴 열기');state.offset=0;load();}
window.addEventListener('hashchange', navigate);
setInterval(async () => {
  if (state.mode !== 'live' || document.hidden || $('#import-dialog').open) return;
  if (state.page !== 'settings' && !$('#rule-review-dialog').open) {
    load(true);
    return;
  }
  if (!state.sound || !state.deviceId) return;
  const deviceId = state.deviceId;
  try {
    const {alerts} = await api('/api/v1/alerts?' + params());
    if (state.mode === 'live' && state.deviceId === deviceId) checkNewAlerts(alerts);
  } catch { /* Keep the current form draft when background polling fails. */ }
}, 10000);
hydrateIcons();navigate();
