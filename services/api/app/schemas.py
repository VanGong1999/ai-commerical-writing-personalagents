from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


def to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class ProjectOut(APIModel):
    id: str
    user_id: str
    title: str
    format: str
    genre_tags: list[str] = []
    market: str
    stage: str
    status: str
    progress: dict[str, Any] = {}
    cover_meta: dict[str, Any] = {}
    budget_tokens: Optional[int] = None
    prompt_pack_id: Optional[str] = None
    token_used: int = 0
    created_at: datetime
    updated_at: datetime
    last_opened_at: datetime


class CreateProjectIn(APIModel):
    title: str
    format: Literal["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"]
    genre_tags: list[str] = []
    market: Literal["cn", "overseas", "both"] = "cn"
    prompt_pack_id: Optional[str] = None
    cover_meta: dict[str, Any] = {}
    start_from: Literal["blank", "kb_dissect", "existing_hook", "ip"] = "blank"
    source_doc_id: Optional[str] = None


class PatchProjectIn(APIModel):
    title: Optional[str] = None
    status: Optional[str] = None
    stage: Optional[str] = None
    genre_tags: Optional[list[str]] = None
    cover_meta: Optional[dict[str, Any]] = None
    budget_tokens: Optional[int] = None


class ArtifactOut(APIModel):
    id: str
    project_id: str
    type: str
    title: str
    status: str
    body_markdown: str = ""
    body_json: Optional[dict[str, Any]] = None
    schema_version: str = "1"
    parent_id: Optional[str] = None
    batch_id: Optional[str] = None
    version: int = 1
    created_by_run_id: Optional[str] = None
    adopted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class AdoptArtifactIn(APIModel):
    expected_version: Optional[int] = Field(default=None, ge=1, strict=True)
    mode: Literal["draft", "strong"] = "strong"


class PatchArtifactIn(APIModel):
    title: Optional[str] = None
    body_markdown: Optional[str] = None
    body_json: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    expected_version: Optional[int] = Field(default=None, ge=1, strict=True)
    via_ontology_action: bool = False


class CreateArtifactIn(APIModel):
    type: str
    title: str
    body_markdown: str = ""
    body_json: Optional[dict[str, Any]] = None
    status: str = "candidate"
    parent_id: Optional[str] = None
    batch_id: Optional[str] = None
    created_by_run_id: Optional[str] = None
    """若为 True，表示经 Ontology Action 物化通道（允许写 action-only 类型）。"""
    via_ontology_action: bool = False


class JobOut(APIModel):
    id: str
    type: str
    payload: dict[str, Any] = {}
    status: str
    priority: int = 0
    project_id: Optional[str] = None
    user_id: str
    attempts: int = 0
    max_attempts: int = 3
    error: Optional[str] = None
    result_ref: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class CreateJobIn(APIModel):
    type: str
    payload: dict[str, Any] = {}
    project_id: Optional[str] = None
    priority: int = 0
    idempotency_key: Optional[str] = None


class CreateRunIn(APIModel):
    project_id: Optional[str] = None
    agent_id: str
    input_json: dict[str, Any] = Field(default_factory=dict)
    # 控制平面恢复：resume|refuse|mark_done（写入 Job.payload）
    operator_decision: Optional[str] = None


class AgentRunOut(APIModel):
    id: str
    project_id: Optional[str] = None
    agent_id: str
    status: str
    input_json: dict[str, Any] = {}
    output_artifact_ids: list[str] = []
    token_prompt: int = 0
    token_completion: int = 0
    model: Optional[str] = None
    gate_results: list[dict[str, Any]] = []
    receipt_id: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None
    # 创建时同步返回，避免前端再扫 /jobs 竞态
    job_id: Optional[str] = None


class RunDigestOut(APIModel):
    id: str
    run_id: str
    narrative: str
    artifacts: list[dict[str, Any]] = []
    memory_changes: list[dict[str, Any]] = []
    gates: list[dict[str, Any]] = []
    leftover: str = ""
    created_at: datetime


class KnowledgeDocOut(APIModel):
    id: str
    title: str
    source: Optional[str] = None
    author: Optional[str] = None
    doc_type: str
    gender_channel: str
    tags: list[str] = []
    status: str
    word_count: Optional[int] = None
    storage_uri: Optional[str] = None
    hash: Optional[str] = None
    visibility: str
    analysis_report_ids: list[str] = []
    graph_id: Optional[str] = None
    folder_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class KbFolderOut(APIModel):
    id: str
    name: str
    created_at: datetime


class CreateFolderIn(APIModel):
    name: str


class MoveDocIn(APIModel):
    folder_id: Optional[str] = None


class AnalysisReportOut(APIModel):
    id: str
    doc_id: str
    report_type: str
    title: str
    body_markdown: str
    body_json: Optional[dict[str, Any]] = None
    schema_version: str
    favorited: bool = False
    source_fragments: list[dict[str, Any]] = []
    created_at: datetime


class ReportPatchIn(APIModel):
    favorited: Optional[bool] = None
    source_fragments: Optional[list[dict[str, Any]]] = None


class TropeClipOut(APIModel):
    id: str
    name: str
    summary: str
    source_doc_id: Optional[str] = None
    source_locator: Optional[str] = None
    tags: list[str] = []
    emotion_peak: Optional[float] = None
    applicable_genres: list[str] = []
    swap_hints: Optional[str] = None
    favorited: bool = False


class GraphOut(APIModel):
    id: str
    doc_id: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class PushToProjectIn(APIModel):
    project_id: str
    mode: Literal["dissect", "swap", "imitate"] = "dissect"


class ComposeSwapIn(APIModel):
    combo_doc_ids: list[str] = []
    degree: Literal["one", "two"] = "one"
    project_id: Optional[str] = None


class MemoryMetaOut(APIModel):
    display_path: Optional[str] = None
    path: str
    user_id: str
    project_id: Optional[str] = None
    store_id: Optional[str] = None
    frozen: bool = False
    hash: Optional[str] = None
    source_run_id: Optional[str] = None
    source_conversation_id: Optional[str] = None
    actor: str = "user"
    memory_kind: Optional[str] = None
    updated_at: datetime
    content: Optional[str] = None
    is_hypothesis: bool = False
    confidence: float = 0.5
    access_count: int = 0
    last_accessed_at: Optional[datetime] = None


class MemoryPutIn(APIModel):
    path: str
    content: str
    project_id: Optional[str] = None
    is_hypothesis: bool = False
    # 乐观并发：传入则强制 CAS；不传则兼容旧客户端无条件写入
    expected_hash: Optional[str] = None
    check_cas: bool = False
    actor: str = "user"
    source_run_id: Optional[str] = None
    source_conversation_id: Optional[str] = None
    change_summary: Optional[str] = None


class MemoryVersionOut(APIModel):
    id: str
    path: str
    store_id: Optional[str] = None
    content: str = ""
    hash: Optional[str] = None
    precondition_hash: Optional[str] = None
    note: Optional[str] = None
    change_summary: Optional[str] = None
    actor: str = "user"
    source_run_id: Optional[str] = None
    source_conversation_id: Optional[str] = None
    created_at: datetime


class CreateMemoryVersionIn(APIModel):
    path: str
    note: Optional[str] = None


class RollbackMemoryIn(APIModel):
    version_id: str


class MemoryStoreOut(APIModel):
    id: str
    name: str
    kind: str
    scope_ref: Optional[str] = None
    description: str = ""
    status: str = "active"
    shared: bool = True
    created_at: datetime
    updated_at: datetime


class MemoryStoreCreateIn(APIModel):
    id: Optional[str] = None
    name: str
    kind: str = "project"
    scope_ref: Optional[str] = None
    description: str = ""
    shared: bool = True


class MemoryMountOut(APIModel):
    id: str
    store_id: str
    conversation_id: Optional[str] = None
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    access: str = "read_write"
    prompt_hint: str = ""
    priority: int = 0
    created_at: datetime


class MemoryMountIn(APIModel):
    store_id: str
    conversation_id: Optional[str] = None
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    access: str = "read_write"
    prompt_hint: str = ""
    priority: int = 0


class DreamChangeOut(APIModel):
    provenance: Optional[dict[str, Any]] = None
    id: str
    dream_job_id: str
    path: str
    op: str
    before_content: str = ""
    after_content: str = ""
    edited_content: Optional[str] = None
    before_hash: Optional[str] = None
    rationale: str = ""
    status: str = "pending"
    conflict_detail: Optional[str] = None
    created_at: datetime


class DreamJobOut(APIModel):
    id: str
    store_id: str
    project_id: Optional[str] = None
    status: str
    title: str
    window_hours: int = 168
    session_ids: list[str] = []
    run_ids: list[str] = []
    instructions: str = ""
    report_markdown: str = ""
    token_estimate: int = 0
    error: Optional[str] = None
    created_by: str = "user"
    created_at: datetime
    finished_at: Optional[datetime] = None
    merged_at: Optional[datetime] = None
    changes: list[DreamChangeOut] = []


class DreamCreateIn(APIModel):
    store_id: Optional[str] = None
    project_id: Optional[str] = None
    title: str = "Dreaming 巩固"
    window_hours: int = 168
    session_ids: list[str] = []
    run_ids: list[str] = []
    instructions: str = ""


class DreamChangePatchIn(APIModel):
    status: Optional[str] = None  # accepted | rejected | pending
    edited_content: Optional[str] = None


class UsageEventOut(APIModel):
    phase: Optional[str] = None
    id: str
    user_id: str
    project_id: Optional[str] = None
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    bot_id: Optional[str] = None
    model: str
    prompt_tokens: int
    completion_tokens: int
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    # 无单价时为 None（前端显示「未配置单价」）
    cost_est: Optional[float] = None
    duration_ms: Optional[int] = None
    created_at: datetime


class AppSettingsPatchIn(APIModel):
    """应用级设置写入：null 表示清除月度用量上限。"""

    usage_budget_monthly: Optional[int] = Field(default=None, ge=0)
    feature_toggles: Optional[dict[str, bool]] = None


class LlmTrafficPatchIn(APIModel):
    """LLM 流量治理：并发上限、自适应、多 Provider 故障转移。"""

    worker_concurrency_cap: Optional[int] = Field(default=None, ge=1, le=16)
    adaptive_enabled: Optional[bool] = None
    failover_enabled: Optional[bool] = None
    fleet_default_concurrency: Optional[int] = Field(default=None, ge=1, le=16)
    pa_defer_when_busy: Optional[bool] = None


class LlmGovernorReportIn(APIModel):
    """Worker / 内部上报：成功或限流，驱动自适应并发。"""

    event: str = Field(description="success | throttle")
    retry_after_s: Optional[float] = Field(default=None, ge=0, le=120)
    provider_id: Optional[str] = None


class TaskProposalOut(APIModel):
    id: str
    type: str
    message: str
    project_id: Optional[str] = None
    actions: list[dict[str, Any]] = []
    status: str
    read: bool
    priority: int = 0
    created_at: datetime
    # approve 响应附带，便于前端跳转追踪
    run_id: Optional[str] = None
    job_id: Optional[str] = None


class ProviderOut(APIModel):
    id: str
    name: str
    base_url: str
    api_key_masked: str
    models: list[str] = []
    selected_model: Optional[str] = None
    enabled: bool = True
    is_default: bool = False
    pricing: dict[str, Any] = {}


class ProviderUpsertIn(APIModel):
    id: Optional[str] = None
    name: str
    base_url: str
    api_key: Optional[str] = None
    models: list[str] = []
    selected_model: Optional[str] = None
    enabled: bool = True
    is_default: bool = False
    pricing: Optional[dict[str, Any]] = None


class ProviderTestIn(APIModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    provider_id: Optional[str] = None


class ProviderTestOut(APIModel):
    ok: bool
    model: Optional[str] = None
    error: Optional[str] = None


class ScheduledTaskOut(APIModel):
    id: str
    name: str
    cron_or_interval: str
    enabled: bool
    owner_scope: str
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    description: Optional[str] = None
    payload_template: dict[str, Any] = {}
    bot_id: Optional[str] = None
    prompt: Optional[str] = None
    trigger_type: str = "schedule"
    event_filter: dict[str, Any] = {}
    quiet_policy: str = "silent_if_nothing"
    active_window: Optional[dict[str, Any]] = None
    run_count: int = 0
    last_cost_tokens: int = 0


class PatchScheduledTaskIn(APIModel):
    cron_or_interval: Optional[str] = None
    enabled: Optional[bool] = None
    prompt: Optional[str] = None


class CreateScheduledTaskIn(APIModel):
    id: Optional[str] = None
    name: str
    cron_or_interval: str = "0 * * * *"
    enabled: bool = True
    owner_scope: str = "assistant"
    description: Optional[str] = None
    payload_template: dict[str, Any] = {}
    bot_id: Optional[str] = None
    prompt: Optional[str] = None
    trigger_type: str = "schedule"
    event_filter: dict[str, Any] = {}
    quiet_policy: str = "silent_if_nothing"
    active_window: Optional[dict[str, Any]] = None
    # 频率低于 1h 时需显式确认
    confirm_high_freq: bool = False


class ProjectSnapshotOut(APIModel):
    id: str
    project_id: str
    name: str
    note: Optional[str] = None
    stage: str
    status: str
    progress: dict[str, Any] = {}
    cover_meta: dict[str, Any] = {}
    artifacts: list[dict[str, Any]] = []
    created_at: datetime


class CreateSnapshotIn(APIModel):
    name: str = "手动快照"
    note: Optional[str] = None


class KbBindingOut(APIModel):
    id: str
    doc_id: str
    project_id: str
    target_type: str
    target_id: str
    mode: str
    created_at: datetime


class HotspotOut(APIModel):
    id: str
    title: str
    genre: str
    source: str
    summary: str
    fetched_at: datetime
    status: str
    meta: dict[str, Any] = Field(default_factory=dict)
    project_id: Optional[str] = None


class BindHotspotIn(APIModel):
    project_id: str


class HotspotUpsertIn(APIModel):
    title: str = Field(min_length=1, max_length=200)
    genre: str = ""
    source: str = "手动"
    summary: str = ""


class CrawlReportOut(APIModel):
    id: str
    source_id: str
    platform: str
    board_name: str
    title: str
    body_markdown: str
    body_json: dict[str, Any] = {}
    item_count: int = 0
    needs_cookie: bool = False
    cookie_hint: str = ""
    status: str = "ok"
    error: Optional[str] = None
    created_at: datetime


class PromptTemplateOut(APIModel):
    id: str
    name: str
    format: list[str]
    stage: str
    locked_system: str
    editable_instruction: str
    locked_hash: str
    required_phrases: list[str] = []
    variables: list[dict[str, Any]] = []
    gates: list[str] = []
    version: int = 1


class PromptValidateIn(APIModel):
    locked_system: str
    locked_hash: str
    editable_instruction: str
    required_phrases: list[str] = []


class GateCheckOut(APIModel):
    id: str
    name: str
    result: str
    message: str


class InspirationOut(APIModel):
    id: str
    user_id: str
    level: str
    source_text: str
    candidates: list[dict[str, Any]] = []
    tags: list[str] = []
    format_hint: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateInspirationIn(APIModel):
    level: Literal["notion", "idea", "concept", "topic"] = "notion"
    source_text: str
    tags: list[str] = []
    format_hint: Optional[str] = None


class SwapPlanOut(APIModel):
    id: str
    user_id: str
    project_id: Optional[str] = None
    source_doc_id: Optional[str] = None
    degree: str
    mapping_json: list[dict[str, Any]] = []
    created_at: datetime
    updated_at: datetime


class CreateSwapPlanIn(APIModel):
    project_id: Optional[str] = None
    source_doc_id: Optional[str] = None
    degree: Literal["one", "two"] = "one"
    mapping_json: list[dict[str, Any]] = []


class CrawlerSourceOut(APIModel):
    id: str
    name: str
    scope: str
    interval: str
    enabled: bool
    robots_ack: bool
    last_run_at: Optional[datetime] = None
    status: str
    needs_cookie: bool = False
    last_error: Optional[str] = None
    last_item_count: int = 0
    has_cookie: bool = False


class CrawlerSourcePatchIn(APIModel):
    enabled: Optional[bool] = None
    robots_ack: Optional[bool] = None
    interval: Optional[str] = None
    cookie: Optional[str] = None


class CrawlerRunIn(APIModel):
    cookie: Optional[str] = None



class AnalyticsOut(APIModel):
    id: str
    project_id: str
    views: int
    favorites: int
    retention: dict[str, Any] = {}
    meta: dict[str, Any] = {}
    created_at: datetime


class AnalyticsIn(APIModel):
    views: int = 0
    favorites: int = 0
    retention: dict[str, Any] = {}
    meta: dict[str, Any] = {}


class CreateCrawlerSourceIn(APIModel):
    id: str
    name: str
    scope: str = ""
    interval: str = "12h"
    enabled: bool = False
    robots_ack: bool = False


class ArtifactVersionOut(APIModel):
    id: str
    artifact_id: str
    version: int
    title: str
    status: str
    body_markdown: str = ""
    body_json: Optional[dict[str, Any]] = None
    note: Optional[str] = None
    actor: str = "user"
    created_at: datetime


class ActivityLogOut(APIModel):
    id: str
    actor: str
    action: str
    summary: str
    project_id: Optional[str] = None
    detail: dict[str, Any] = {}
    created_at: datetime


class AssistantChatIn(APIModel):
    message: str
    project_id: Optional[str] = None
    format: Optional[str] = None
    path: Optional[str] = None


class AssistantAction(APIModel):
    type: str  # navigate / run_agent / schedule / crawl / open_project
    label: str
    to: Optional[str] = None
    agent_id: Optional[str] = None
    project_id: Optional[str] = None
    task_id: Optional[str] = None
    source_id: Optional[str] = None
    payload: dict[str, Any] = {}


class AssistantChatOut(APIModel):
    reply: str
    actions: list[AssistantAction] = []
    tool_results: list[dict[str, Any]] = []
    run_id: Optional[str] = None


class CowriteIn(APIModel):
    text: str
    mode: Literal["continue", "polish", "deai", "expand"] = "polish"
    instruction: Optional[str] = None
    project_id: Optional[str] = None


class CowriteOut(APIModel):
    result: str
    hint: str = ""


class ConversationOut(APIModel):
    id: str
    source: str
    user_id: str
    project_id: Optional[str] = None
    title: str
    kind: str = "dm"
    bot_id: Optional[str] = None
    team_id: Optional[str] = None
    member_bot_ids: list[str] = []
    group_rules: dict[str, Any] = {}
    external_chat_id: Optional[str] = None
    external_open_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateConversationIn(APIModel):
    source: Literal["assistant", "feishu"] = "assistant"
    project_id: Optional[str] = None
    title: Optional[str] = None
    kind: Literal["dm", "group", "routine", "bot_dm"] = "dm"
    bot_id: Optional[str] = None
    team_id: Optional[str] = None
    member_bot_ids: list[str] = []
    group_rules: dict[str, Any] = {}


class ContextRefRequest(APIModel):
    kind: Literal["artifact", "kb_doc", "report", "draft", "file"]
    source_id: str = Field(min_length=1, max_length=200)
    project_id: Optional[str] = None
    version: Optional[int] = Field(default=None, ge=1, strict=True)
    start: Optional[int] = Field(default=None, ge=0, strict=True)
    end: Optional[int] = Field(default=None, ge=0, strict=True)
    quote: Optional[str] = Field(default=None, max_length=4000)
    draft_text: Optional[str] = Field(default=None, max_length=500_000)
    title: Optional[str] = Field(default=None, max_length=300)
    snapshot_id: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    content_hash: Optional[str] = None
    id: Optional[str] = None


class ContextRefOut(APIModel):
    id: str
    kind: Literal["artifact", "kb_doc", "report", "draft", "file"]
    source_id: str
    project_id: Optional[str] = None
    version: Optional[int] = None
    start: int
    end: int
    quote: str
    title: str
    content_hash: str
    snapshot_id: Optional[str] = None
    context_before: str = ""
    context_after: str = ""


class ContextSourceOut(APIModel):
    text: str
    title: str
    version: int
    project_id: str


class ContextResolveIn(APIModel):
    refs: list[ContextRefRequest] = Field(min_length=1, max_length=8)


class ContextResolveOut(APIModel):
    refs: list[ContextRefOut]
    manifest: dict[str, int]


class MessageOut(APIModel):
    id: str
    conversation_id: str
    role: str
    content: str = ""
    tool_calls: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    confirm: bool = False
    run_id: Optional[str] = None
    bot_id: Optional[str] = None
    mentions: list[str] = []
    evidence: list[dict[str, Any]] = []
    context_refs: list[ContextRefOut] = []
    created_at: datetime


class ChatConversationIn(APIModel):
    client_message_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    context_refs: list[ContextRefRequest] = Field(default_factory=list, max_length=8)
    message: str
    project_id: Optional[str] = None
    mention_bot_ids: list[str] = []
    force_continue: bool = False


class RespondConversationIn(APIModel):
    approve: bool
    message_id: Optional[str] = None
    edited_args: Optional[dict[str, Any]] = None


# —— AI 同事（Bot / Team / Skill）——


class BotOut(APIModel):
    execution: dict[str, Any] = Field(default_factory=dict)
    id: str
    name: str
    aliases: list[str] = []
    avatar: dict[str, Any] = {}
    persona: str = ""
    tone: str = ""
    duties: list[str] = []
    never_do: list[str] = []
    role_kind: str = "specialist"
    delegate_only: bool = False
    allowed_agent_ids: list[str] = []
    tool_allowlist: list[str] = []
    model_profile: str = "default"
    trust_level: int = 1
    veto_window_min: int = 60
    restate_before_act: bool = False
    notify_policy: str = "important"
    weekly_token_budget: Optional[int] = None
    pinned: bool = False
    is_system: bool = False
    template_id: Optional[str] = None
    status: str = "active"
    owner_user_id: str
    created_at: datetime
    updated_at: datetime


class BotCreateIn(APIModel):
    execution: dict[str, Any] = Field(default_factory=dict)
    name: str
    aliases: list[str] = []
    avatar: dict[str, Any] = {}
    persona: str = ""
    tone: str = ""
    duties: list[str] = []
    never_do: list[str] = []
    role_kind: str = "specialist"
    delegate_only: bool = False
    allowed_agent_ids: list[str] = []
    tool_allowlist: list[str] = []
    model_profile: str = "default"
    trust_level: int = 1
    veto_window_min: int = 60
    restate_before_act: bool = False
    notify_policy: str = "important"
    weekly_token_budget: Optional[int] = None
    pinned: bool = False
    template_id: Optional[str] = None


class BotPatchIn(APIModel):
    execution: dict[str, Any] = Field(default_factory=dict)
    name: Optional[str] = None
    aliases: Optional[list[str]] = None
    avatar: Optional[dict[str, Any]] = None
    persona: Optional[str] = None
    tone: Optional[str] = None
    duties: Optional[list[str]] = None
    never_do: Optional[list[str]] = None
    role_kind: Optional[str] = None
    delegate_only: Optional[bool] = None
    allowed_agent_ids: Optional[list[str]] = None
    tool_allowlist: Optional[list[str]] = None
    model_profile: Optional[str] = None
    trust_level: Optional[int] = None
    veto_window_min: Optional[int] = None
    restate_before_act: Optional[bool] = None
    notify_policy: Optional[str] = None
    weekly_token_budget: Optional[int] = None
    pinned: Optional[bool] = None
    status: Optional[str] = None


class BotSkillOut(APIModel):
    id: str
    bot_id: Optional[str] = None
    name: str
    slash: str
    when_to_use: str = ""
    inputs: list[dict[str, Any]] = []
    steps_md: str = ""
    evidence_required: bool = False
    confirm_when: str = ""
    version: int = 1
    trust_stage: str = "saved"
    clean_runs: int = 0
    source_conversation_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BotSkillCreateIn(APIModel):
    name: str
    slash: Optional[str] = None
    when_to_use: str = ""
    inputs: list[dict[str, Any]] = []
    steps_md: str = ""
    evidence_required: bool = False
    confirm_when: str = ""
    source_conversation_id: Optional[str] = None


class BotTeamOut(APIModel):
    id: str
    name: str
    member_bot_ids: list[str] = []
    lead_bot_id: Optional[str] = None
    rules_md: str = ""
    truth_source_path: Optional[str] = None
    speak_policy: str = "orchestrated"
    max_rounds: int = 6
    owner_user_id: str
    template_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BotTeamCreateIn(APIModel):
    name: str
    member_bot_ids: list[str] = []
    lead_bot_id: Optional[str] = None
    rules_md: str = ""
    truth_source_path: Optional[str] = None
    speak_policy: str = "orchestrated"
    max_rounds: int = 6
    template_id: Optional[str] = None


class BotTeamPatchIn(APIModel):
    name: Optional[str] = None
    member_bot_ids: Optional[list[str]] = None
    lead_bot_id: Optional[str] = None
    rules_md: Optional[str] = None
    truth_source_path: Optional[str] = None
    speak_policy: Optional[str] = None
    max_rounds: Optional[int] = None


class BotInterviewIn(APIModel):
    answers: dict[str, Any] = {}
    free_text: Optional[str] = None


class BotTemplateOut(APIModel):
    id: str
    kind: str  # bot | team
    name: str
    description: str = ""
    payload: dict[str, Any] = {}


class BotImportIn(APIModel):
    template_id: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    name_override: Optional[str] = None
