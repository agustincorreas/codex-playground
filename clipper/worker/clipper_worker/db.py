"""Acceso a Postgres (Supabase) con psycopg."""
from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import config


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(config.DATABASE_URL, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def _jsonb(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return Jsonb(value)
    return value


def claim_job() -> dict | None:
    with connect() as conn:
        row = conn.execute("select * from claim_job()").fetchone()
        return row


def finish_job(job_id: str, error: str | None = None, requeue: bool = False) -> None:
    with connect() as conn:
        if requeue:
            conn.execute(
                "update jobs set status='queued', locked_at=null, error=%s where id=%s",
                (error, job_id),
            )
        else:
            conn.execute(
                "update jobs set status=%s, finished_at=now(), error=%s where id=%s",
                ("error" if error else "done", error, job_id),
            )


def requeue_stale_jobs(max_age_minutes: int = 180) -> int:
    """Trabajos que quedaron en 'running' porque el worker se reinició."""
    with connect() as conn:
        cur = conn.execute(
            """update jobs set status='queued', locked_at=null, error='reintentado tras reinicio del worker'
               where status='running' and locked_at < now() - (%s || ' minutes')::interval
                 and attempts < 3""",
            (str(max_age_minutes),),
        )
        n = cur.rowcount or 0
        conn.execute(
            """update jobs set status='error', finished_at=now(), error='el worker se reinició demasiadas veces con este trabajo'
               where status='running' and locked_at < now() - (%s || ' minutes')::interval""",
            (str(max_age_minutes),),
        )
        return n


def get_video(video_id: str) -> dict | None:
    with connect() as conn:
        return conn.execute("select * from videos where id=%s", (video_id,)).fetchone()


def update_video(video_id: str, **fields: Any) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k}=%s" for k in fields)
    with connect() as conn:
        conn.execute(
            f"update videos set {sets} where id=%s",
            [*(_jsonb(v) for v in fields.values()), video_id],
        )


def set_video_status(video_id: str, status: str, detail: str | None = None) -> None:
    update_video(video_id, status=status, status_detail=detail)


def get_clip(clip_id: str) -> dict | None:
    with connect() as conn:
        return conn.execute("select * from clips where id=%s", (clip_id,)).fetchone()


def update_clip(clip_id: str, **fields: Any) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k}=%s" for k in fields)
    with connect() as conn:
        conn.execute(
            f"update clips set {sets} where id=%s",
            [*(_jsonb(v) for v in fields.values()), clip_id],
        )


def replace_clips(video_id: str, clips: list[dict]) -> list[dict]:
    """Borra los candidatos previos del video e inserta los nuevos."""
    with connect() as conn:
        with conn.transaction():
            conn.execute("delete from clips where video_id=%s", (video_id,))
            rows = []
            for position, c in enumerate(clips):
                row = conn.execute(
                    """insert into clips (video_id, position, start_s, end_s, orig_start_s, orig_end_s,
                                          title, hook, score, reason, subtitles)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
                    (
                        video_id, position, c["start_s"], c["end_s"], c["start_s"], c["end_s"],
                        c["title"], c["hook"], c["score"], c["reason"], Jsonb(c.get("subtitles") or []),
                    ),
                ).fetchone()
                rows.append(row)
            conn.execute("update videos set candidates_count=%s where id=%s", (len(rows), video_id))
            return rows


def get_preset(preset_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("select * from presets where id=%s", (preset_id,)).fetchone()
        return row


def upsert_builtin_presets(presets: dict[str, dict]) -> None:
    with connect() as conn:
        for pid, cfg in presets.items():
            conn.execute(
                """insert into presets (id, name, builtin, config) values (%s,%s,true,%s)
                   on conflict (id) do nothing""",
                (pid, cfg["name"], Jsonb(cfg)),
            )


def get_setting(key: str) -> Any:
    with connect() as conn:
        row = conn.execute("select value from settings where key=%s", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: Any) -> None:
    with connect() as conn:
        conn.execute(
            """insert into settings (key, value) values (%s, %s)
               on conflict (key) do update set value=excluded.value, updated_at=now()""",
            (key, Jsonb(value)),
        )


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
