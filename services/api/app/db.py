from __future__ import annotations

import logging
import time
from collections.abc import Generator

from sqlalchemy import event, text
from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, create_engine

from .settings import get_settings
from . import models  # noqa: F401  # 注册全部表，保证 init_db() 的 create_all 能建新表

_settings = get_settings()
logger = logging.getLogger(__name__)
_connect_args: dict = {"check_same_thread": False, "timeout": 15} if _settings.is_sqlite else {}

if _settings.is_sqlite:
    # ensure relative sqlite path works from services/api
    url = _settings.database_url
    if url.startswith("sqlite:///./"):
        from pathlib import Path

        data_dir = Path(__file__).resolve().parent.parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        # 尊重配置里的文件名（如 e2e.db），不要把自定义库名静默覆盖成 dev.db
        rel = url.removeprefix("sqlite:///./").lstrip("/")
        db_name = Path(rel).name or "dev.db"
        url = f"sqlite:///{data_dir / db_name}"
else:
    url = _settings.database_url

# SQLite 是单写多读、连接极廉价的本地库：并发请求下用 NullPool（每个会话一条独立连接），
# 从根本上消除 QueuePool(5+10) 溢出导致的 502「connection timed out」。
# 非 SQLite（Postgres 等）保留有界连接池，避免打爆远端连接数。
_engine_kwargs: dict = {}
if _settings.is_sqlite:
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs.update(
        pool_size=8,
        max_overflow=16,
        pool_timeout=10,
        pool_recycle=1800,
        pool_pre_ping=True,
    )

engine = create_engine(url, echo=False, connect_args=_connect_args, **_engine_kwargs)

if _settings.is_sqlite:
    # 本地多进程（api / job-worker / scheduler）共享同一个 SQLite 文件：
    # WAL 允许多读一写，busy_timeout 在写锁竞争时等待而不是立刻 database is locked。
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            # 并发写冲突时最多等 15s（WAL 单写者），而不是立刻 database is locked。
            cursor.execute("PRAGMA busy_timeout=15000")
        finally:
            cursor.close()


def _exec_migration_sql(conn, sql: str) -> None:
    """迁移语句带重试：只在「列已存在」时静默，锁冲突等临时错误退避重试。"""
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            conn.exec_driver_sql(sql)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            message = str(exc).lower()
            if "duplicate column" in message or "already exists" in message:
                return
            time.sleep(0.4 * (attempt + 1))
    logger.warning("db migration failed after retries: %s (%s)", sql[:80], last_error)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _migrate_sqlite_columns()
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.exec_driver_sql("ALTER TABLE agentrun ADD COLUMN IF NOT EXISTS knowledge_role_version VARCHAR")
            connection.exec_driver_sql("ALTER TABLE bot ADD COLUMN IF NOT EXISTS execution JSON NOT NULL DEFAULT '{}'")
            connection.exec_driver_sql("ALTER TABLE agentevent ADD COLUMN IF NOT EXISTS owner_token VARCHAR")
            connection.exec_driver_sql("ALTER TABLE agentevent ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP")
            connection.exec_driver_sql("ALTER TABLE agentevent ADD COLUMN IF NOT EXISTS execution_started BOOLEAN DEFAULT FALSE")
        connection.execute(text("""
            INSERT INTO inboxkey (conversation_id, dedupe_key, event_id)
            SELECT conversation_id, dedupe_key, id FROM (
                SELECT conversation_id, dedupe_key, id, row_number() OVER (
                    PARTITION BY conversation_id, dedupe_key ORDER BY created_at, id
                ) AS position FROM agentevent WHERE dedupe_key <> ''
            ) ranked WHERE position = 1
            ON CONFLICT (conversation_id, dedupe_key) DO NOTHING
        """))
        connection.execute(text("""
            UPDATE agentevent SET status = 'superseded'
            WHERE status = 'pending' AND EXISTS (
                SELECT 1 FROM inboxkey k WHERE k.conversation_id = agentevent.conversation_id
                AND k.dedupe_key = agentevent.dedupe_key AND (
                    k.event_id <> agentevent.id OR EXISTS (
                        SELECT 1 FROM agentevent e WHERE e.conversation_id = k.conversation_id
                        AND e.dedupe_key = k.dedupe_key AND e.id <> agentevent.id
                        AND e.status IN ('done', 'failed', 'processing')
                    )
                )
            )
        """))


def _migrate_sqlite_columns() -> None:
    """给已有 SQLite 库补列，避免 recreate。"""
    if not _settings.is_sqlite:
        return
    statements = [
        "ALTER TABLE dreamchange ADD COLUMN candidate_key TEXT",
        "ALTER TABLE dreamchange ADD COLUMN provenance JSON",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_dreamchange_candidate_key ON dreamchange(candidate_key)",
        "ALTER TABLE agentevent ADD COLUMN reply_delivery JSON",
        "ALTER TABLE message ADD COLUMN reply_delivery JSON",
        "ALTER TABLE feishureplypart ADD COLUMN total_attempts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE agentevent ADD COLUMN owner_token VARCHAR",
        "ALTER TABLE agentevent ADD COLUMN claimed_at DATETIME",
        "ALTER TABLE agentevent ADD COLUMN execution_started BOOLEAN DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS ix_watchdog_current_time ON runstep(created_at DESC) "
        "WHERE kind='watchdog' AND coalesce(json_extract(payload,'$.reason'),'') != 'subscription_unreleased'",
        "CREATE INDEX IF NOT EXISTS ix_watchdog_current_conv ON runstep(conversation_id,seq DESC) "
        "WHERE kind='watchdog' AND coalesce(json_extract(payload,'$.reason'),'') != 'subscription_unreleased'",
        "CREATE INDEX IF NOT EXISTS ix_runstep_subscription_seq ON runstep(json_extract(payload,'$.subId'),seq DESC)",
        "ALTER TABLE hotspot ADD COLUMN meta JSON",
        "ALTER TABLE crawlersource ADD COLUMN needs_cookie BOOLEAN DEFAULT 0",
        "ALTER TABLE crawlersource ADD COLUMN last_error TEXT",
        "ALTER TABLE crawlersource ADD COLUMN last_item_count INTEGER DEFAULT 0",
        "ALTER TABLE crawlersource ADD COLUMN cookie TEXT",
        "ALTER TABLE providerconfig ADD COLUMN is_default BOOLEAN DEFAULT 0",
        "ALTER TABLE providerconfig ADD COLUMN selected_model VARCHAR",
        "ALTER TABLE providerconfig ADD COLUMN pricing JSON",
        "ALTER TABLE analysisreport ADD COLUMN favorited BOOLEAN DEFAULT 0",
        "ALTER TABLE analysisreport ADD COLUMN source_fragments JSON",
        "ALTER TABLE usageevent ADD COLUMN cache_hit_tokens INTEGER DEFAULT 0",
        "ALTER TABLE usageevent ADD COLUMN cache_miss_tokens INTEGER DEFAULT 0",
        "ALTER TABLE activitylog ADD COLUMN conversation_id TEXT",
        "ALTER TABLE job ADD COLUMN conversation_id TEXT",
        "ALTER TABLE agentrun ADD COLUMN knowledge_role_version TEXT",
        "ALTER TABLE agentrun ADD COLUMN conversation_id TEXT",
        "ALTER TABLE taskproposal ADD COLUMN priority INTEGER DEFAULT 0",
        "ALTER TABLE conversation ADD COLUMN external_chat_id TEXT",
        "ALTER TABLE conversation ADD COLUMN external_open_id TEXT",
        "ALTER TABLE conversation ADD COLUMN scratchpad JSON",
        # 守护任务编排字段
        "ALTER TABLE job ADD COLUMN task_group_id TEXT",
        "ALTER TABLE job ADD COLUMN progress_pct INTEGER DEFAULT 0",
        "ALTER TABLE job ADD COLUMN progress_stage TEXT",
        "ALTER TABLE agentrun ADD COLUMN task_group_id TEXT",
        "ALTER TABLE agentrun ADD COLUMN depends_on_run_ids JSON",
        "ALTER TABLE agentrun ADD COLUMN approval_state TEXT DEFAULT 'none'",
        "ALTER TABLE agentrun ADD COLUMN progress_pct INTEGER DEFAULT 0",
        "ALTER TABLE agentrun ADD COLUMN progress_stage TEXT",
        "ALTER TABLE agentrun ADD COLUMN checkpoint BOOLEAN DEFAULT 0",
        "ALTER TABLE agentrun ADD COLUMN label TEXT",
        # 自管理记忆：Store / 归属 / CAS
        "ALTER TABLE memoryfile ADD COLUMN store_id TEXT",
        "ALTER TABLE memoryfile ADD COLUMN source_conversation_id TEXT",
        "ALTER TABLE memoryfile ADD COLUMN actor TEXT DEFAULT 'user'",
        "ALTER TABLE memoryfile ADD COLUMN memory_kind TEXT",
        "ALTER TABLE memoryfile ADD COLUMN confidence FLOAT DEFAULT 0.5",
        "ALTER TABLE memoryfile ADD COLUMN access_count INTEGER DEFAULT 0",
        "ALTER TABLE memoryfile ADD COLUMN last_accessed_at DATETIME",
        "ALTER TABLE memoryversion ADD COLUMN store_id TEXT",
        "ALTER TABLE memoryversion ADD COLUMN precondition_hash TEXT",
        "ALTER TABLE memoryversion ADD COLUMN change_summary TEXT",
        "ALTER TABLE memoryversion ADD COLUMN source_run_id TEXT",
        "ALTER TABLE memoryversion ADD COLUMN source_conversation_id TEXT",
        # AI 同事 / MAS
        "ALTER TABLE usageevent ADD COLUMN bot_id TEXT",
        "ALTER TABLE conversation ADD COLUMN kind TEXT DEFAULT 'dm'",
        "ALTER TABLE conversation ADD COLUMN bot_id TEXT",
        "ALTER TABLE conversation ADD COLUMN team_id TEXT",
        "ALTER TABLE conversation ADD COLUMN member_bot_ids JSON",
        "ALTER TABLE conversation ADD COLUMN group_rules JSON",
        "ALTER TABLE message ADD COLUMN bot_id TEXT",
        "ALTER TABLE message ADD COLUMN mentions JSON",
        "ALTER TABLE message ADD COLUMN evidence JSON",
        "ALTER TABLE scheduledtask ADD COLUMN bot_id TEXT",
        "ALTER TABLE scheduledtask ADD COLUMN prompt TEXT",
        "ALTER TABLE scheduledtask ADD COLUMN trigger_type TEXT DEFAULT 'schedule'",
        "ALTER TABLE scheduledtask ADD COLUMN event_filter JSON",
        "ALTER TABLE scheduledtask ADD COLUMN quiet_policy TEXT DEFAULT 'silent_if_nothing'",
        "ALTER TABLE scheduledtask ADD COLUMN active_window JSON",
        "ALTER TABLE scheduledtask ADD COLUMN run_count INTEGER DEFAULT 0",
        "ALTER TABLE scheduledtask ADD COLUMN last_cost_tokens INTEGER DEFAULT 0",
        # Agent Instance 生命周期：租约 / 心跳 / 执行 checkpoint
        "ALTER TABLE bot ADD COLUMN execution JSON NOT NULL DEFAULT '{}'",
        "ALTER TABLE bot ADD COLUMN notify_policy TEXT DEFAULT 'important'",
        "ALTER TABLE agentrun ADD COLUMN lease_owner TEXT",
        "ALTER TABLE agentrun ADD COLUMN lease_until DATETIME",
        "ALTER TABLE agentrun ADD COLUMN lease_version INTEGER DEFAULT 0",
        "ALTER TABLE agentrun ADD COLUMN heartbeat_at DATETIME",
        "ALTER TABLE agentrun ADD COLUMN operator_resumed_at_s REAL",
        "ALTER TABLE agentrun ADD COLUMN attempt INTEGER DEFAULT 0",
        "ALTER TABLE agentrun ADD COLUMN max_attempts INTEGER DEFAULT 3",
        "ALTER TABLE agentrun ADD COLUMN exec_checkpoint JSON",
        "ALTER TABLE agentrun ADD COLUMN control_signal TEXT",
        "ALTER TABLE agentevent ADD COLUMN priority INTEGER DEFAULT 10",
        "ALTER TABLE agentevent ADD COLUMN target_bot_id TEXT",
    ]
    with engine.begin() as conn:
        for sql in statements:
            _exec_migration_sql(conn, sql)
        try:
            _exec_migration_sql(
                conn,
                "UPDATE analysisreport SET favorited = 0 WHERE favorited IS NULL"
            )
            _exec_migration_sql(
                conn,
                "UPDATE analysisreport SET source_fragments = '[]' WHERE source_fragments IS NULL"
            )
        except Exception:
            pass
        # 新增 JSON 列对旧行是 NULL，但响应模型要求 list/dict，必须回填默认值，否则列表接口 500
        for sql in _JSON_BACKFILL_STATEMENTS:
            try:
                _exec_migration_sql(conn, sql)
            except Exception:
                pass


_JSON_BACKFILL_STATEMENTS = [
    "UPDATE conversation SET member_bot_ids = '[]' WHERE member_bot_ids IS NULL",
    "UPDATE conversation SET group_rules = '{}' WHERE group_rules IS NULL",
    "UPDATE conversation SET scratchpad = '{}' WHERE scratchpad IS NULL",
    "UPDATE message SET mentions = '[]' WHERE mentions IS NULL",
    "UPDATE message SET evidence = '[]' WHERE evidence IS NULL",
    "UPDATE scheduledtask SET event_filter = '{}' WHERE event_filter IS NULL",
    "UPDATE agentrun SET depends_on_run_ids = '[]' WHERE depends_on_run_ids IS NULL",
    "UPDATE agentrun SET exec_checkpoint = '{}' WHERE exec_checkpoint IS NULL",
    "UPDATE bot SET notify_policy = 'important' WHERE notify_policy IS NULL",
    "UPDATE agentrun SET lease_version = 0 WHERE lease_version IS NULL",
    "UPDATE agentrun SET attempt = 0 WHERE attempt IS NULL",
    "UPDATE agentrun SET max_attempts = 3 WHERE max_attempts IS NULL",
]


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def get_engine():
    return engine
