## DUSD Dashboard (local MVP)

Clean MVP web dashboard for **DUSD on Solana** with:
- **SQLite** storage (`backend/data/dusd.db`)
- **One-time seed** of `burn_events` from a provided CSV (no historical backfill in production)
- **Hourly incremental** sync (burns + supply + holders + DEX Screener snapshot)
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
- **Incremental burns**: on each hourly run, it fetches recent signatures for the mint and stops once it reaches `app_state.last_seen_burn_signature`.
- **7D/30D volume**: displayed as an **estimate** derived from stored hourly `volume_24h` snapshots.

