"""Forward new rows from an Arduino CSV logger to the local AirGuard API.

Uses only Python's standard library. Existing rows are skipped in follow mode.
AIRGUARD_DEVICE_TOKEN is read from the environment and never printed.
"""
import argparse
import csv
import datetime as dt
import io
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import uuid
from zoneinfo import ZoneInfo

METRICS = ('dht_temp_C', 'dht_humi_pct', 'am_temp_C', 'am_humi_pct',
           'co2_ppm', 'voc_level', 'pm25_ugm3')


def sample_from_row(row, timezone):
    timestamp = dt.datetime.fromisoformat(row['timestamp'].strip())
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=ZoneInfo(timezone))
    metrics = {}
    for name in METRICS:
        text = str(row.get(name, '') or '').strip()
        value = float(text) if text else None
        if value is not None and not math.isfinite(value):
            value = None
        metrics[name] = value
    return {'sample_id': str(uuid.uuid4()), 'measured_at': timestamp.isoformat(),
            'metrics': metrics}


def send_batch(endpoint, device, token, batch_id, samples):
    data = json.dumps({'schema_version': '1.0', 'device_id': device,
                       'batch_id': batch_id, 'samples': samples},
                      allow_nan=False).encode('utf-8')
    request = urllib.request.Request(endpoint, data=data, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description='Send new Arduino CSV rows to AirGuard')
    parser.add_argument('file', type=Path, help='CSV file written by the Arduino logger')
    parser.add_argument('--device', default='lab-01')
    parser.add_argument('--url', default='http://127.0.0.1:4173')
    parser.add_argument('--timezone', default='Asia/Seoul')
    parser.add_argument('--follow', action='store_true', help='Skip existing rows and follow new lines')
    args = parser.parse_args()
    token = os.environ.get('AIRGUARD_DEVICE_TOKEN', '')
    if not token:
        parser.error('AIRGUARD_DEVICE_TOKEN must be set in the environment')
    if not args.file.is_file():
        parser.error('CSV file does not exist')
    endpoint = args.url.rstrip('/') + '/api/v1/measurements/batch'
    ZoneInfo(args.timezone)
    with args.file.open('r', encoding='utf-8-sig', newline='') as stream:
        header = next(csv.reader([stream.readline()]))
        if 'timestamp' not in header:
            parser.error('CSV header requires timestamp')
        if args.follow:
            stream.seek(0, io.SEEK_END)
            print('Following new CSV rows. Existing history is not replayed.', flush=True)
        pending = []
        batch_id = str(uuid.uuid4())
        last_send = time.monotonic()
        retry_after = 0.0
        backoff = 1.0
        eof = False
        while True:
            if len(pending) < 100:
                offset = stream.tell()
                line = stream.readline()
                eof = not bool(line)
                if line and not line.endswith(('\n', '\r')) and args.follow:
                    stream.seek(offset)
                    line = ''
                if line:
                    try:
                        values = next(csv.reader([line]))
                        if len(values) != len(header):
                            raise ValueError('column count mismatch')
                        pending.append(sample_from_row(dict(zip(header, values)), args.timezone))
                    except (ValueError, KeyError) as error:
                        print(f'Invalid CSV row at offset {offset}: {error}', file=sys.stderr)
                    continue
            else:
                line = None
            now = time.monotonic()
            should_send = pending and (len(pending) >= 100 or now - last_send >= 5 or not args.follow)
            if should_send and now >= retry_after:
                try:
                    result = send_batch(endpoint, args.device, token, batch_id, pending)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
                    pending = []
                    batch_id = str(uuid.uuid4())
                    last_send = now
                    backoff = 1.0
                except urllib.error.HTTPError as error:
                    if error.code in (400, 401, 403, 404, 409, 413):
                        print(f'API rejected the batch (HTTP {error.code}). Check device, token and schema.', file=sys.stderr)
                        return 1
                    retry_after = now + backoff
                    backoff = min(backoff * 2, 30)
                    print(f'HTTP {error.code}. Retrying with the same batch ID.', file=sys.stderr)
                except (urllib.error.URLError, TimeoutError, OSError):
                    retry_after = now + backoff
                    backoff = min(backoff * 2, 30)
                    print('Server unavailable. Pausing reads and retrying the queued batch.', file=sys.stderr)
            if not args.follow and eof and not pending:
                break
            time.sleep(.25)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\nGateway stopped. Source CSV remains available for import.', file=sys.stderr)
