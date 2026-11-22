from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./data/dev.db"
    redis_url: str = "redis://127.0.0.1:6379/0"

    minio_endpoint: str = "127.0.0.1:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "xiezuomanju"
    minio_secure: bool = False

    milvus_uri: str = "http://127.0.0.1:19530"
    milvus_collection: str = "kb_chunks"

    # Primary OpenAI-compatible provider. The active provider can be changed in
    # Settings; these values are only the environment fallback.
    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimaxi.com/v1"
    minimax_model: str = "MiniMax-M3.1-Flash"
    minimax_reasoning_effort: Literal["low", "medium", "high", "max"] = "low"
    agent_llm_timeout_s: float = 600.0
    personal_agent_max_output_tokens: int = Field(default=8192, ge=1024, le=32768)

    # Keep DeepSeek as an explicit, independently configurable provider.
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"
    llm_default_provider: str = "minimax"

    openai_compat_api_key: str = ""
    openai_compat_base_url: str = ""
    openai_compat_model: str = "gpt-4o-mini"

    secrets_fernet_key: str = ""

    web_search_enabled: bool = False
    web_search_provider: str = "bocha"
    bocha_api_key: str = ""
    serper_api_key: str = ""

    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"

    deai_detect_url: str = ""
    deai_detect_token: str = ""

    api_cors_origins: str = (
        "http://127.0.0.1:5173,http://localhost:5173,"
        "http://127.0.0.1:5174,http://localhost:5174"
    )
    local_api_token: str = ""
    local_api_require_token: bool = False
    demo_user_id: str = "00000000-0000-4000-8000-000000000001"
    seed_on_start: bool = True

    # 飞书（WebSocket 长连接）。secret 只放 .env，不入库、不硬编码。
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    # group: mention=群聊需 @bot；always=群聊任意消息都响应
    feishu_group_policy: str = "mention"
    # 主动推送默认目标（open chat_id）；空则用最近一次飞书会话绑定
    feishu_default_chat_id: str = ""
    # 卡住的 AgentRun 超过该分钟数则 Watchdog 提醒
    feishu_watchdog_stuck_minutes: int = 15
    # 飞书进度是否逐条推送 tool_call（0=安静批处理）
    feishu_progress_verbose: bool = False
    # Personal Agent 确认超时自动应答：超过 N 分钟未操作即按默认批准继续
    personal_agent_confirm_timeout_min: int = 10
    # 队列卫生恢复宽限期（秒）：DB queued 但 Redis 队列无信封超过该时长才幂等重入队
    queue_recovery_after_s: int = 90
    # 队列卫生恢复窗口（小时）：超过该时长的陈旧 queued 任务判 dead，不自动复活
    queue_recovery_window_hours: int = 6
    personal_agent_auto_respond: bool = True
    # 群聊 candidate 是否入收件箱由总编语义层判断（默认关，避免白耗 token）
    feishu_candidate_review: bool = False
    # 投机执行：缺口扫描时后台预起草
    speculative_enabled: bool = False
    speculative_daily_cap: int = 2

    # 可选：各平台 Cookie（也可用抓取时请求体传入）
    crawler_cookie_fanqie: str = ""
    crawler_cookie_jinjiang: str = ""
    crawler_cookie_feilu: str = ""
    crawler_cookie_qimao: str = ""
    crawler_cookie_qidian: str = ""
    crawler_cookie_hongguo: str = ""

    job_events_channel_prefix: str = "job:events:"
    job_queue_key: str = "jobs:queue"
    job_agent_queue_key: str = "jobs:agent"
    job_cancel_prefix: str = "job:cancel:"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def effective_minimax_api_key(self) -> str:
        if self.minimax_api_key:
            return self.minimax_api_key
        # Compatibility for deployments that used DEEPSEEK_* as legacy
        # variable names while pointing them at MiniMax.
        if "minimax" in self.deepseek_base_url.lower():
            return self.deepseek_api_key
        if "minimax" in self.openai_compat_base_url.lower():
            return self.openai_compat_api_key
        return ""

    @property
    def effective_minimax_base_url(self) -> str:
        return self.minimax_base_url.rstrip("/")

    @property
    def effective_minimax_model(self) -> str:
        if (
            "minimax" in self.deepseek_base_url.lower()
            and self.deepseek_model
            and not self.deepseek_model.startswith("deepseek-")
        ):
            return self.deepseek_model
        return self.minimax_model


@lru_cache
def get_settings() -> Settings:
    return Settings()
