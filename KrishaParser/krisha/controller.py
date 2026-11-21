from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict, dataclass

from . import config
from .db import Database
from .fetcher import Fetcher, FetchResult, HttpEngine, PlaywrightEngine
from .logging_setup import get_logger

log = get_logger("controller")


class CaptchaStop(RuntimeError):
    pass


class LayoutChangeStop(RuntimeError):
    pass


class BlockedStop(RuntimeError):
    pass


class NetworkStop(RuntimeError):
    pass


@dataclass
class RuntimeProfile:
    engine: str = "http"
    delay_ms: int = config.START_DELAY_MS
    concurrency: int = 1

    @classmethod
    def load(cls) -> "RuntimeProfile":
        try:
            data = json.loads(config.RUNTIME_PROFILE_PATH.read_text("utf-8"))
            return cls(**{k: data[k] for k in ("engine", "delay_ms", "concurrency")
                          if k in data})
        except (FileNotFoundError, ValueError, KeyError):
            return cls()

    def save(self) -> None:
        config.RUNTIME_PROFILE_PATH.write_text(
            json.dumps(asdict(self), indent=2), encoding="utf-8"
        )


class Controller:
    def __init__(self, db: Database, run_id: str | None = None) -> None:
        self.db = db
        self.run_id = run_id or uuid.uuid4().hex[:12]
        self.profile = RuntimeProfile.load()
        self.delay_ms = max(config.MIN_DELAY_MS, self.profile.delay_ms)
        self.concurrency = min(config.MAX_CONCURRENCY, max(1, self.profile.concurrency))
        self._success_streak = 0
        self._empty_streak = 0
        self._engines: dict[str, Fetcher] = {}
        self._jitter_seq = 0

    def engine(self, name: str) -> Fetcher:
        if name not in self._engines:
            self._engines[name] = (
                HttpEngine() if name == "http" else PlaywrightEngine()
            )
        return self._engines[name]

    def close(self) -> None:
        self._save_profile("http")
        for e in self._engines.values():
            e.close()

    def _sleep_delay(self) -> int:
        self._jitter_seq += 1
        frac = ((self._jitter_seq * 2654435761) % 1000) / 1000.0
        jitter = (frac - 0.5) * 0.30
        delay = int(self.delay_ms * (1 + jitter))
        delay = max(config.MIN_DELAY_MS, min(config.MAX_DELAY_MS, delay))
        time.sleep(delay / 1000.0)
        return delay

    def fetch(self, url: str, engine: str, referer: str | None = None) -> tuple[FetchResult, int]:
        attempts = 0
        while True:
            delay_used = self._sleep_delay()
            result = self.engine(engine).fetch(url, referer=referer)

            if result.is_captcha:
                self._record(result, "captcha", delay_used)
                log.error("CAPTCHA at %s -> stopping run, cooldown %.0fs",
                          url, config.COOLDOWN_S)
                time.sleep(config.COOLDOWN_S)
                raise CaptchaStop(url)

            if result.is_block or result.status_code is None:
                self._on_block(result)
                attempts += 1
                cooldown = result.retry_after or config.COOLDOWN_S
                log.warning("request failed (%s) at %s, cooldown %.0fs (attempt %d)",
                            result.status_code, url, cooldown, attempts)
                self._record(result, result.classify(), delay_used)
                if attempts > config.MAX_RETRIES:
                    if result.status_code is None:
                        raise NetworkStop(f"{url}: routes unavailable after {attempts} attempts")
                    raise BlockedStop(f"{url} status={result.status_code}")
                time.sleep(cooldown)
                rotate = getattr(self.engine(engine), "rotate_proxy", None)
                if rotate:
                    rotate()
                continue

            return result, delay_used

    def record(self, result: FetchResult, outcome: str, delay_ms: int) -> None:
        self._record(result, outcome, delay_ms)
        if outcome == "ok":
            if not result.from_cache:
                self._on_success()
            self._empty_streak = 0
        elif outcome == "empty_parse":
            self._empty_streak += 1
            if self._empty_streak >= config.EMPTY_PARSE_STOP_STREAK:
                raise LayoutChangeStop(
                    f"{self._empty_streak} empty parses in a row — layout changed?"
                )

    def _record(self, result: FetchResult, outcome: str, delay_ms: int) -> None:
        self.db.log_event(
            self.run_id, result.url, result.engine, result.status_code,
            result.latency_ms, delay_ms, self.concurrency, outcome,
        )

    def _on_success(self) -> None:
        self._success_streak += 1
        if self._success_streak >= 3 and self.delay_ms > config.MIN_DELAY_MS:
            self.delay_ms = max(config.MIN_DELAY_MS, int(self.delay_ms * 0.9))
            self._success_streak = 0
            log.debug("delay decreased to %d ms", self.delay_ms)

    def _on_block(self, result: FetchResult) -> None:
        self._success_streak = 0
        self.delay_ms = min(config.MAX_DELAY_MS, self.delay_ms * 2)
        self.concurrency = 1
        log.info("delay increased to %d ms, concurrency -> 1", self.delay_ms)

    def _save_profile(self, engine: str) -> None:
        self.profile = RuntimeProfile(engine, self.delay_ms, self.concurrency)
        self.profile.save()
