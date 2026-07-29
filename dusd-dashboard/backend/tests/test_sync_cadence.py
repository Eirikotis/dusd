from __future__ import annotations

import sqlite3
import unittest
from types import SimpleNamespace

from app.db import migrate, state_get, state_set
from app.sync import _holder_refresh_due, sync_incremental_burns


def _memory_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    return conn


class _FailingParserHelius:
    def get_signatures_for_address(self, address, *, before=None, limit=1000):
        return [{"signature": "new-signature"}]

    def parse_transactions(self, signatures):
        raise RuntimeError("temporary parser failure")


class SyncCadenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = _memory_conn()

    def tearDown(self) -> None:
        self.conn.close()

    def test_holder_refresh_is_due_only_after_configured_interval(self) -> None:
        self.assertTrue(_holder_refresh_due(self.conn, interval_minutes=60, now_ts=10_000))
        state_set(self.conn, "last_holder_sync_ts", "10000")
        self.conn.commit()
        self.assertFalse(_holder_refresh_due(self.conn, interval_minutes=60, now_ts=13_599))
        self.assertTrue(_holder_refresh_due(self.conn, interval_minutes=60, now_ts=13_600))

    def test_failed_parser_does_not_advance_burn_cursor(self) -> None:
        settings = SimpleNamespace(
            dusd_mint="mint",
            max_sig_pages=1,
            sig_page_size=1000,
            parse_batch_size=100,
            helius_sleep_s=0,
        )

        with self.assertRaises(RuntimeError):
            sync_incremental_burns(
                settings=settings,
                helius=_FailingParserHelius(),
                conn=self.conn,
            )

        self.assertIsNone(state_get(self.conn, "last_seen_burn_signature"))


if __name__ == "__main__":
    unittest.main()
