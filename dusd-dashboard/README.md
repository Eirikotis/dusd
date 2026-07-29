## DUSD Dashboard (local MVP)

Clean MVP web dashboard for **DUSD on Solana** with:
- **SQLite** storage (`backend/data/dusd.db`)
- **One-time seed** of `burn_events` from a provided CSV (no historical backfill in production)
- **15-minute incremental** sync (burns + supply + DEX Screener), with holders refreshed hourly
- **Frontend**: retro-dark, simple, bold, arcade-ish UI

### Requirements

- **Python 3.11+**

### Quick start

1. Create a virtualenv and install deps.

```bash
cd dusd-dashboard
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend/requirements.txt
```

2. Create your env file.

```bash
copy backend\.env.example backend\.env
```

3. Run the server.

```bash
python -m backend.app.main
```

Open `http://127.0.0.1:8787`.

### Notes

- **Seeding behavior**: the app seeds `burn_events` exactly once from `SEED_BURN_CSV` and then sets `app_state.seeded_from_csv=1`. After that it will **never** re-import the CSV unless you delete `backend/data/dusd.db`.
- **Incremental burns**: every 15 minutes, it fetches recent signatures for the mint and stops once it reaches `app_state.last_seen_burn_signature`.
- **Refresh controls**: `SYNC_INTERVAL_MINUTES` defaults to `15`; `HOLDER_SYNC_INTERVAL_MINUTES` defaults to `60`. The latest holder count is retained between full holder scans.
- **Market-cap scenarios**: Bitcoin and PAX Gold proxy prices are cached from CoinGecko on the 15-minute sync. `COINGECKO_API_KEY` is optional and enables a free Demo key; the keyless public endpoint is the fallback.
- **7D/30D volume**: displayed as an **estimate** derived from stored hourly `volume_24h` snapshots.
- **Scarcity history**: starts at the first stored DUSD supply observation and expands by one day rather than remaining a fixed rolling window.
- **Admin sync routes**: set `ADMIN_API_KEY` and send it as the `X-Admin-Key` header. Without a configured key, manual admin routes are disabled; scheduled syncs continue normally.

