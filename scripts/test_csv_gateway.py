import contextlib
import datetime as dt
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import csv_gateway


class GatewayTest(unittest.TestCase):
    def test_timestamp_and_missing_values(self):
        sample = csv_gateway.sample_from_row({
            'timestamp': '2026-10-07 14:05:46', 'co2_ppm': '2760',
            'voc_level': '0', 'pm25_ugm3': '',
        }, 'Asia/Seoul')
        self.assertEqual(sample['measured_at'], '2026-10-07T14:05:46+09:00')
        self.assertEqual(sample['metrics']['co2_ppm'], 2760)
        self.assertEqual(sample['metrics']['voc_level'], 0)
        self.assertIsNone(sample['metrics']['pm25_ugm3'])
        self.assertNotIn('read_status', sample)

    def test_once_reads_more_than_one_batch(self):
        batches = []

        def record(endpoint, device, token, batch_id, samples):
            batches.append((batch_id, list(samples)))
            return {'accepted': len(samples)}

        with tempfile.TemporaryDirectory(prefix='airguard-gateway-test-') as directory:
            source = Path(directory) / 'log.csv'
            # Generated test fixture, not production sensor readings.
            stamp = dt.datetime(2026, 10, 7, 14, 0)
            rows = ['timestamp,co2_ppm,pm25_ugm3']
            rows.extend(f'{stamp + dt.timedelta(seconds=i)},813,7' for i in range(153))
            source.write_text('\n'.join(rows) + '\n', encoding='utf-8')
            with patch.dict(os.environ, {'AIRGUARD_DEVICE_TOKEN': 'test-only'}), \
                 patch('sys.argv', ['csv_gateway.py', str(source)]), \
                 patch.object(csv_gateway, 'send_batch', side_effect=record), \
                 patch.object(csv_gateway.time, 'sleep'), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(csv_gateway.main(), 0)
        self.assertEqual([len(samples) for _, samples in batches], [100, 53])
        self.assertNotEqual(batches[0][0], batches[1][0])


if __name__ == '__main__':
    unittest.main()
