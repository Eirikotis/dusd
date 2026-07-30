from __future__ import annotations

import logging
import secrets
import threading
import time
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .clients.dexscreener import DexScreenerClient
from .clients.helius import HeliusClient
from .config import load_settings
from .db import (
    Db,
    connect,
    migrate,
    purge_hourly_snapshots_if_mint_changed,
    seed_burn_events_from_csv_once,
    state_get,
    upsert_hourly_snapshot,
)
from .metrics import current_overview, daily_burn_totals, recent_burns, timeframe_metrics, trading_metrics
from .scarcity import (
    scarcity_dashboard,
    sync_scarcity_data,
    sync_scarcity_market_prices,
)
from .sync import run_hourly_sync_once


def create_app() -> FastAPI:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    log = logging.getLogger("dusd.app")

    load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=False)
    settings = load_settings()
    log.info("settings.loaded mint=%s helius_key_present=%s", settings.dusd_mint, bool(settings.helius_api_key))

    db = Db(path=str(Path(__file__).resolve().parents[1] / settings.sqlite_path))
    conn = connect(db)
    migrate(conn)
    purge_hourly_snapshots_if_mint_changed(conn, dusd_mint=settings.dusd_mint)

    # One-time seed from CSV (no production historical backfill).
    seed_res = seed_burn_events_from_csv_once(conn=conn, csv_path=str(Path(__file__).resolve().parents[1] / settings.seed_burn_csv))
    log.info("seed.result %s", seed_res)

    helius = None
    if settings.helius_rpc_url and settings.helius_parse_tx_url:
        helius = HeliusClient(rpc_url=settings.helius_rpc_url, parse_tx_url=settings.helius_parse_tx_url, sleep_s=settings.helius_sleep_s)
    dexs = DexScreenerClient()

    app = FastAPI(title="DUSD Dashboard API", version="0.1.0")
    app.state.settings = settings
    app.state.conn = conn
    app.state.seed_result = seed_res
    app.state.helius = helius
    app.state.dexs = dexs
    app.state.sync_status = {
        "last_sync_start_ts": None,
        "last_sync_end_ts": None,
        "last_success": None,
        "last_error": None,
    }
    app.state.data_sync_lock = threading.Lock()

    scarcity_bootstrapped = False
    if settings.run_scheduler and settings.sync_on_start:
        scarcity_count = conn.execute(
            "SELECT COUNT(1) AS c FROM scarcity_observations"
        ).fetchone()
        if not scarcity_count or int(scarcity_count["c"]) == 0:
            log.info("scarcity.bootstrap.start")
            try:
                bootstrap_result = sync_scarcity_data(conn)
                scarcity_bootstrapped = all(
                    bootstrap_result.get(asset, {}).get("ok")
                    for asset in ("DUSD", "BTC", "GOLD", "M2")
                )
                log.info("scarcity.bootstrap.end result=%s", bootstrap_result)
            except Exception:
                log.exception("scarcity.bootstrap.fail")

        market_price_count = conn.execute(
            "SELECT COUNT(1) AS c FROM scarcity_market_prices"
        ).fetchone()
        if not market_price_count or int(market_price_count["c"]) == 0:
            log.info("market_prices.bootstrap.start")
            try:
                market_result = sync_scarcity_market_prices(
                    conn, coingecko_api_key=settings.coingecko_api_key
                )
                log.info("market_prices.bootstrap.end result=%s", market_result)
            except Exception:
                log.exception("market_prices.bootstrap.fail")

    # Static frontend
    frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
    assets_dir = Path(__file__).resolve().parents[2] / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    if frontend_dir.exists():
        app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.get("/")
    def index():
        p = frontend_dir / "index.html"
        if not p.exists():
            raise HTTPException(404, "frontend not found")
        return FileResponse(str(p))

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "seed": app.state.seed_result,
            "has_helius": bool(settings.helius_api_key),
            "helius_key_loaded": bool(settings.helius_api_key),
            "last_seen_burn_signature": state_get(conn, "last_seen_burn_signature"),
        }

    @app.get("/api/current")
    def api_current():
        return current_overview(
            conn, original_supply=settings.original_supply, dusd_mint=settings.dusd_mint
        )

    @app.get("/api/metrics")
    def api_metrics(window: str, days: int | None = None):
        try:
            return timeframe_metrics(
                conn, window_key=window, dusd_mint=settings.dusd_mint, custom_days=days
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/trading")
    def api_trading(window: str):
        return trading_metrics(
            conn, window_key=window, dusd_mint=settings.dusd_mint, dexs=app.state.dexs
        )

    @app.get("/api/burns")
    def api_burns(limit: int = 50):
        return {"items": recent_burns(conn, limit=limit)}

    @app.get("/api/burns/daily")
    def api_burns_daily(days: int = 90):
        return {"points": daily_burn_totals(conn, days=days)}

    @app.get("/api/scarcity")
    def api_scarcity():
        return scarcity_dashboard(conn)

    @app.post("/api/admin/scarcity-sync")
    def admin_scarcity_sync(x_admin_key: str | None = Header(default=None)):
        _require_admin_key(settings.admin_api_key, x_admin_key)
        with app.state.data_sync_lock:
            return sync_scarcity_data(conn)

    @app.post("/api/admin/sync-once")
    def admin_sync_once(x_admin_key: str | None = Header(default=None)):
        _require_admin_key(settings.admin_api_key, x_admin_key)
        if not app.state.helius:
            raise HTTPException(400, "HELIUS_API_KEY not configured")
        with app.state.data_sync_lock:
            return run_hourly_sync_once(
                settings=settings,
                helius=app.state.helius,
                dexs=app.state.dexs,
                conn=conn,
            )

    @app.get("/api/debug/sync-status")
    def debug_sync_status():
        latest = conn.execute(
            "SELECT * FROM token_snapshots_hourly WHERE dusd_mint = ? ORDER BY hour_ts DESC LIMIT 1",
            (settings.dusd_mint,),
        ).fetchone()
        burn_count = conn.execute("SELECT COUNT(1) AS c FROM burn_events").fetchone()
        return {
            **app.state.sync_status,
            "latest_snapshot": None if latest is None else dict(latest),
            "last_seen_burn_signature": state_get(conn, "last_seen_burn_signature"),
            "burn_events_count": int(burn_count["c"]) if burn_count else 0,
        }

    def _sync_job():
        with app.state.data_sync_lock:
            app.state.sync_status["last_sync_start_ts"] = int(time.time())
            app.state.sync_status["last_error"] = None
            log.info("sync_job.start")
            try:
                h = app.state.helius
                if h is None and settings.helius_rpc_url and settings.helius_parse_tx_url:
                    # late-init (env updated without restart is rare, but harmless)
                    app.state.helius = HeliusClient(
                        rpc_url=settings.helius_rpc_url,
                        parse_tx_url=settings.helius_parse_tx_url,
                        sleep_s=settings.helius_sleep_s,
                    )
                    h = app.state.helius

                if h is None:
                    # No Helius configured: store a DEX-only snapshot.
                    pairs = app.state.dexs.fetch_pairs(
                        chain_id="solana", token_address=settings.dusd_mint
                    )
                    best = app.state.dexs.choose_best_pair_by_liquidity_usd(pairs)
                    dex_snap = app.state.dexs.parse_snapshot(best)
                    hour_ts = int(time.time()) - (int(time.time()) % 3600)
                    upsert_hourly_snapshot(
                        conn,
                        hour_ts=hour_ts,
                        snapshot=dex_snap,
                        dusd_mint=settings.dusd_mint,
                    )
                else:
                    run_hourly_sync_once(
                        settings=settings,
                        helius=h,
                        dexs=app.state.dexs,
                        conn=conn,
                    )

                try:
                    market_result = sync_scarcity_market_prices(
                        conn, coingecko_api_key=settings.coingecko_api_key
                    )
                    log.info("market_prices.ok result=%s", market_result)
                except Exception:
                    # Keep serving the last successful prices if the public
                    # market-data source is temporarily unavailable.
                    log.exception("market_prices.fail")
                app.state.sync_status["last_success"] = True
            except Exception as e:
                # best-effort scheduler; surface via logs when run locally
                app.state.sync_status["last_success"] = False
                app.state.sync_status["last_error"] = str(e)
                log.exception("sync_job.fail")
            finally:
                app.state.sync_status["last_sync_end_ts"] = int(time.time())
                log.info("sync_job.end success=%s", app.state.sync_status["last_success"])

    def _scarcity_job():
        with app.state.data_sync_lock:
            log.info("scarcity_job.start")
            try:
                result = sync_scarcity_data(conn)
                log.info("scarcity_job.end result=%s", result)
            except Exception:
                log.exception("scarcity_job.fail")

    if settings.run_scheduler:
        sched = BackgroundScheduler(daemon=True)
        sched.add_job(
            _sync_job,
            "interval",
            minutes=settings.sync_interval_minutes,
            id="incremental_sync",
            max_instances=1,
            coalesce=True,
        )
        sched.add_job(
            _scarcity_job,
            "interval",
            hours=24,
            id="daily_scarcity_sync",
            max_instances=1,
            coalesce=True,
        )
        sched.start()
        app.state.scheduler = sched
        log.info(
            "scheduler.started sync_interval=%dm holder_interval=%dm sync_on_start=%s",
            settings.sync_interval_minutes,
            settings.holder_sync_interval_minutes,
            settings.sync_on_start,
        )

        if settings.sync_on_start:
            threading.Thread(target=_sync_job, daemon=True).start()
            if not scarcity_bootstrapped:
                threading.Thread(target=_scarcity_job, daemon=True).start()

    return app


def _require_admin_key(configured_key: str | None, supplied_key: str | None) -> None:
    if not configured_key:
        raise HTTPException(status_code=503, detail="Admin API is disabled")
    if not supplied_key or not secrets.compare_digest(supplied_key, configured_key):
        raise HTTPException(status_code=401, detail="Invalid admin key")


def main():
    import uvicorn

    app = create_app()
    settings = app.state.settings
    # Pass the app object directly to avoid re-importing the module (which would
    # create duplicate schedulers and run sync twice).
    uvicorn.run(app, host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()

