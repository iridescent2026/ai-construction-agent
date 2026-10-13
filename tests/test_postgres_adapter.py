"""Guard the shared adapter's transaction boundary for startup and feed batches."""
from common.database import PostgreSQL


def test_batch_inserts_and_deletes_share_transaction_without_implicit_commit():
    events = []

    class Cursor:
        def executemany(self, sql, rows):
            events.append((sql, list(rows)))

    class Connection:
        def cursor(self):
            return Cursor()

        def commit(self):
            events.append('commit')

        def rollback(self):
            events.append('rollback')

    adapter = PostgreSQL.__new__(PostgreSQL)
    adapter.db = Connection()
    adapter.schema = 'isolated_test'
    adapter.executemany('INSERT OR IGNORE INTO meter_readings VALUES (?,?)',
                       ((str(i), '{}') for i in range(2)))
    adapter.executemany('DELETE FROM meter_readings WHERE id=?', [('0',)])
    assert events == [
        ('INSERT INTO meter_readings VALUES (%s,%s) ON CONFLICT DO NOTHING',
         [('0', '{}'), ('1', '{}')]),
        ('DELETE FROM meter_readings WHERE id=%s', [('0',)]),
    ]
    adapter.rollback()
    assert events[-1] == 'rollback'
