from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class Project(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    title: str
    format: str = Field(index=True)
    genre_tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    market: str = "cn"
    stage: str
    status: str = "active"
    progress: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    cover_meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    budget_tokens: Optional[int] = None
    prompt_pack_id: Optional[str] = None
    token_used: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    last_opened_at: datetime = Field(default_factory=utcnow)


class Artifact(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(index=True)
    type: str = Field(index=True)
    title: str
    status: str = "draft"
    body_markdown: str = ""
    body_json: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    schema_version: str = "1"
    parent_id: Optional[str] = None
    batch_id: Optional[str] = None
    version: int = 1
    created_by_run_id: Optional[str] = None
    adopted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ArtifactVersion(SQLModel, table=True):
    """Artifact 的不可变历史快照，支持 git 式 diff 与回滚。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    artifact_id: str = Field(index=True)
    version: int
    title: str
    status: str
    body_markdown: str = ""
    body_json: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    note: Optional[str] = None
    actor: str = "user"  # user / assistant / agent:<agent_id> / system
    created_at: datetime = Field(default_factory=utcnow)


class ActivityLog(SQLModel, table=True):
    """系统运行痕迹：谁在什么时候对什么做了什么。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    actor: str = "user"  # user / assistant / agent:<agent_id> / system
    action: str = "chat"  # chat / kb_search / run_agent / schedule_task / crawl / navigate / artifact_edit / adopt / rollback / project_update
    summary: str
    project_id: Optional[str] = Field(default=None, index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    detail: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class ProjectStageEvent(SQLModel, table=True):
    """项目阶段流转审计：用于「各 Stage 停留时长」等分析与回放。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(index=True)
    from_stage: Optional[str] = None  # 首次入 Stage 时为 None
    to_stage: str
    actor: str = "user"  # user / assistant / agent:<agent_id> / system
    reason: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class AppSetting(SQLModel, table=True):
    """应用级键值设置（单用户本地场景）：如月度用量上限。"""

    key: str = Field(primary_key=True)
    value_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utcnow)


class Job(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    type: str
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = "queued"
    priority: int = 0
    project_id: Optional[str] = Field(default=None, index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    user_id: str
    attempts: int = 0
    max_attempts: int = 3
    scheduled_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    result_ref: Optional[str] = None
    parent_job_id: Optional[str] = None
    idempotency_key: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    # 守护任务进度（与 AgentRun 同步，供 SSE /tasks/stream）
    task_group_id: Optional[str] = Field(default=None, index=True)
    progress_pct: int = 0
    progress_stage: Optional[str] = None


class AgentRun(SQLModel, table=True):
    knowledge_role_version: Optional[str] = None
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: Optional[str] = Field(default=None, index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    agent_id: str
    status: str = "queued"
    input_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    output_artifact_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    token_prompt: int = 0
    token_completion: int = 0
    model: Optional[str] = None
    gate_results: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    receipt_id: Optional[str] = None
    parent_run_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None
    # 跨书/多章守护编排
    task_group_id: Optional[str] = Field(default=None, index=True)
    depends_on_run_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    approval_state: str = "none"  # none | waiting | approved | rejected
    progress_pct: int = 0
    progress_stage: Optional[str] = None
    checkpoint: bool = False  # checkpoint_gate 模式下是否需人工确认（审批门，≠ 执行 checkpoint）
    label: Optional[str] = None
    # —— Agent Instance 生命周期（Docker 容器式）：租约 / 心跳 / 执行态 checkpoint ——
    lease_owner: Optional[str] = None
    lease_until: Optional[datetime] = None
    lease_version: int = 0  # 每次 acquire +1；旧 worker 的写入用它做 fencing
    heartbeat_at: Optional[datetime] = None
    # Server UTC epoch seconds of the last committed operator pause → queue transition.
    operator_resumed_at_s: Optional[float] = None
    attempt: int = 0
    max_attempts: int = 3
    exec_checkpoint: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    control_signal: Optional[str] = None  # None | pause | stop（随 heartbeat 下发给 worker）


class RunDigest(SQLModel, table=True):
    """run 结束后的决策摘要（narrator）：产物/记忆变更/门禁/遗留 + LLM 叙述。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    run_id: str = Field(index=True)
    narrative: str = ""
    artifacts: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    memory_changes: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    gates: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    leftover: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class AsyncTaskGroup(SQLModel, table=True):
    """跨书/多章/多智能体守护编排容器（Docker Daemon 风格任务组）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    title: str = "后台任务组"
    goal: str = ""
    kind: str = "multi_agent"  # multi_book | multi_chapter | multi_agent
    approval_mode: str = "auto_pilot"  # auto_pilot | checkpoint_gate
    max_concurrency: int = 4
    status: str = "running"  # running | waiting_approval | paused | completed | partial_failed | cancelled
    plan_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None
    updated_at: datetime = Field(default_factory=utcnow)


class UsageEvent(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    project_id: Optional[str] = Field(default=None, index=True)
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    # AI 同事（具名 Bot）维度，与目录 Agent 的 agent_id 区分
    bot_id: Optional[str] = Field(default=None, index=True)
    model: str
    prompt_tokens: int
    completion_tokens: int
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    cost_est: float = 0
    duration_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=utcnow)


class Bot(SQLModel, table=True):
    """持久化具名 AI 同事：独立上下文 + 技能 + 例程。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str = Field(index=True)
    aliases: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    avatar: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))  # emoji/color/image
    persona: str = ""
    tone: str = ""
    duties: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    never_do: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    role_kind: str = "specialist"  # lead | worker | specialist | designer | chief
    delegate_only: bool = False
    execution: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    allowed_agent_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    tool_allowlist: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    model_profile: str = "default"
    trust_level: int = 1  # 0=readonly 1=propose 2=reversible 3=own-role+veto
    veto_window_min: int = 60
    restate_before_act: bool = False
    notify_policy: str = "important"  # all | important | none：代主人操作系统时何时推送通知（审计始终记录）
    weekly_token_budget: Optional[int] = None
    pinned: bool = False
    is_system: bool = False
    template_id: Optional[str] = None
    status: str = "active"  # active | paused | archived
    owner_user_id: str = Field(default="demo_user", index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class BotSkill(SQLModel, table=True):
    """Bot 可复用技能；bot_id 为空表示共享技能。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    bot_id: Optional[str] = Field(default=None, index=True)
    name: str
    slash: str = Field(index=True)
    when_to_use: str = ""
    inputs: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    steps_md: str = ""
    evidence_required: bool = False
    confirm_when: str = ""
    version: int = 1
    trust_stage: str = "saved"  # watched | saved | one_shot | routine
    clean_runs: int = 0
    source_conversation_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class BotTeam(SQLModel, table=True):
    """可复用的多智能体团队（MAS）组合。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    member_bot_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    lead_bot_id: Optional[str] = None
    rules_md: str = ""
    truth_source_path: Optional[str] = None
    speak_policy: str = "orchestrated"  # mention_only | orchestrated | free
    max_rounds: int = 6
    owner_user_id: str = Field(default="demo_user", index=True)
    template_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Conversation(SQLModel, table=True):
    """Personal Agent / Bot 对话（助手右下角 / 飞书 / 群聊），统一会话入口。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    source: str = "assistant"  # assistant | feishu
    user_id: str = Field(index=True)
    project_id: Optional[str] = Field(default=None, index=True)
    title: str = "新对话"
    # dm=私聊 | group=多Bot群聊 | routine=例程干净会话 | bot_dm=Bot之间私信
    kind: str = "dm"
    bot_id: Optional[str] = Field(default=None, index=True)
    team_id: Optional[str] = Field(default=None, index=True)
    member_bot_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    group_rules: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # 飞书：按 chat 隔离（单聊一人一会话 / 群聊一群一会话）
    external_chat_id: Optional[str] = Field(default=None, index=True)
    external_open_id: Optional[str] = Field(default=None, index=True)
    # 会话级易失草稿（30–60 分钟相关，compaction 可丢）
    scratchpad: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Message(SQLModel, table=True):
    """对话内一条消息（用户/助手/工具/系统），含 tool_calls 与操作账本 actions。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    conversation_id: str = Field(index=True)
    role: str = "user"  # user | assistant | tool | system
    content: str = ""
    tool_calls: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    actions: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    # Private continuation route pinned when a confirmation is created.
    reply_delivery: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    run_id: Optional[str] = None
    bot_id: Optional[str] = Field(default=None, index=True)
    mentions: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    evidence: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class FeishuIdentity(SQLModel, table=True):
    """飞书 open_id → 本地 user_id 映射（当前单用户，映射到 demo_user）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    open_id: str = Field(index=True)
    user_id: str = Field(index=True)
    created_at: datetime = Field(default_factory=utcnow)


class FeishuDeliveryBind(SQLModel, table=True):
    """飞书出站绑定：conversation → chat_id，供进度/完成/主动提案推送。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    conversation_id: str = Field(index=True)
    chat_id: str = Field(index=True)
    open_id: Optional[str] = Field(default=None, index=True)
    updated_at: datetime = Field(default_factory=utcnow)


class FeishuReplyPart(SQLModel, table=True):
    # Primary key is also the immutable Feishu create-message UUID.
    id: str = Field(primary_key=True)
    conversation_id: str = Field(index=True)
    message_id: str = Field(index=True)
    position: int
    chat_id: Optional[str] = None
    msg_type: str
    body: str
    status: str = Field(index=True)
    attempts: int = 0
    total_attempts: int = 0
    manual_retries: int = 0
    first_attempt: Optional[datetime] = None
    due: datetime = Field(default_factory=utcnow, index=True)
    lease: Optional[str] = None
    ambiguous: bool = False
    remote_id: Optional[str] = None
    detail: str = ""


class KnowledgeDoc(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    title: str
    source: Optional[str] = None
    author: Optional[str] = None
    doc_type: str
    gender_channel: str = "unknown"
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    status: str = "ready"
    word_count: Optional[int] = None
    storage_uri: Optional[str] = None
    hash: Optional[str] = Field(default=None, index=True)
    visibility: str = "private"
    analysis_report_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    graph_id: Optional[str] = None
    folder_id: Optional[str] = None
    user_id: str = Field(index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class KbFolder(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    user_id: str = Field(index=True)
    created_at: datetime = Field(default_factory=utcnow)


class AnalysisReport(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    doc_id: str = Field(index=True)
    report_type: str
    title: str
    body_markdown: str
    body_json: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    schema_version: str = "1"
    favorited: bool = False
    source_fragments: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class TropeClip(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    summary: str
    source_doc_id: Optional[str] = None
    source_locator: Optional[str] = None
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    emotion_peak: Optional[float] = None
    applicable_genres: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    swap_hints: Optional[str] = None
    favorited: bool = False


class GraphSnapshot(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    doc_id: str = Field(index=True)
    nodes: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    edges: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))


class StoryFingerprint(SQLModel, table=True):
    """拆书后的故事指纹：题材/金手指/梗类别/情绪曲线/桥段标签/单元结构，用于相似书判断。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    doc_id: str = Field(index=True)
    vector: list[float] = Field(default_factory=list, sa_column=Column(JSON))
    genre: str = ""
    gold_finger: str = ""
    hook_category: str = ""
    emotion_curve: list[float] = Field(default_factory=list, sa_column=Column(JSON))
    trope_tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    unit_purposes: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class MemoryStore(SQLModel, table=True):
    """显式记忆库：组织/用户/项目/Agent/会话/Dream 工作区。"""

    id: str = Field(primary_key=True)  # e.g. project.{id}.bible / user.profile
    name: str
    kind: str = Field(index=True)  # org|user|project|agent|session|fleet|dream_workspace
    scope_ref: Optional[str] = Field(default=None, index=True)  # project_id / agent_id / conversation_id
    description: str = ""
    status: str = "active"  # active | retired
    shared: bool = True  # False = agent/session 独立
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class MemoryMount(SQLModel, table=True):
    """Session/Run 对 MemoryStore 的挂载（只读/读写 + 引导提示）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    store_id: str = Field(index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    run_id: Optional[str] = Field(default=None, index=True)
    agent_id: Optional[str] = Field(default=None, index=True)
    access: str = "read_write"  # read_only | read_write
    prompt_hint: str = ""
    priority: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class MemoryFile(SQLModel, table=True):
    path: str = Field(primary_key=True)
    user_id: str = Field(index=True)
    project_id: Optional[str] = None
    store_id: Optional[str] = Field(default=None, index=True)
    frozen: bool = False
    hash: Optional[str] = None
    source_run_id: Optional[str] = None
    source_conversation_id: Optional[str] = None
    actor: str = "user"  # user | assistant | agent:{id} | dream:{job_id} | system
    content: str = ""
    is_hypothesis: bool = False
    memory_kind: Optional[str] = None  # episodic|semantic|procedural|reflection|scratch|bible|journal|other
    updated_at: datetime = Field(default_factory=utcnow)
    confidence: float = 0.5
    access_count: int = 0
    last_accessed_at: Optional[datetime] = None


class MemoryVersion(SQLModel, table=True):
    """记忆文件的历史快照，支持一键回滚（git 式）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    path: str = Field(index=True)
    store_id: Optional[str] = Field(default=None, index=True)
    content: str = ""
    hash: Optional[str] = None
    precondition_hash: Optional[str] = None  # 写入前内容哈希（乐观并发基础）
    note: Optional[str] = None
    change_summary: Optional[str] = None
    actor: str = "user"  # user / agent:<agent_id> / dream:<job_id> / system
    source_run_id: Optional[str] = None
    source_conversation_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class DreamJob(SQLModel, table=True):
    """Out-of-band Dreaming：扫描 transcripts → 产出 PR 式变更提案 → 用户确认合入。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    store_id: str = Field(index=True)
    project_id: Optional[str] = Field(default=None, index=True)
    status: str = "pending"  # pending|running|ready|merging|merged|partial|rejected|failed
    title: str = "Dreaming 巩固"
    window_hours: int = 168
    session_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    run_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    instructions: str = ""
    report_markdown: str = ""
    token_estimate: int = 0
    error: Optional[str] = None
    created_by: str = "user"
    created_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None
    merged_at: Optional[datetime] = None


class DreamChange(SQLModel, table=True):
    """Dreaming 产出的单文件变更（PR 提案行）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    candidate_key: Optional[str] = Field(default=None, unique=True, index=True)
    provenance: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    dream_job_id: str = Field(index=True)
    path: str = Field(index=True)
    op: str = "update"  # create|update|merge|delete|verify
    before_content: str = ""
    after_content: str = ""
    edited_content: Optional[str] = None  # 用户审查时修改后的内容
    before_hash: Optional[str] = None
    rationale: str = ""
    status: str = "pending"  # pending|accepted|rejected|conflict|merged
    conflict_detail: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class TaskProposal(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    type: str
    message: str
    project_id: Optional[str] = None
    actions: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    status: str = "pending"
    read: bool = False
    priority: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class ProjectSnapshot(SQLModel, table=True):
    """整项目快照：progress / stage / cover_meta / 全部产物，支持一键回滚。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(index=True)
    name: str
    note: Optional[str] = None
    stage: str = ""
    status: str = "active"
    progress: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    cover_meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    artifacts: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class KbBinding(SQLModel, table=True):
    """知识库文档/报告 → 项目产物的绑定，用于回显与撤销。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    doc_id: str = Field(index=True)
    project_id: str = Field(index=True)
    target_type: str  # artifact / swap_plan / project_meta
    target_id: str
    mode: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class ProviderConfig(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    base_url: str
    api_key_enc: str = ""
    api_key_masked: str = "****"
    models: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    selected_model: Optional[str] = None
    enabled: bool = True
    is_default: bool = False
    # model -> {input, cachedInput, output}，单位：元 / 百万 tokens
    pricing: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class ScheduledTask(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    cron_or_interval: str
    enabled: bool = False
    owner_scope: str = "system"
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    description: Optional[str] = None
    payload_template: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # AI 同事例程扩展
    bot_id: Optional[str] = Field(default=None, index=True)
    prompt: Optional[str] = None
    trigger_type: str = "schedule"  # schedule | event
    event_filter: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    quiet_policy: str = "silent_if_nothing"  # silent_if_nothing | digest | immediate
    active_window: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    run_count: int = 0
    last_cost_tokens: int = 0


class Hotspot(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    title: str
    genre: str
    source: str
    summary: str
    fetched_at: datetime = Field(default_factory=utcnow)
    status: str = "ok"
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class CrawlReport(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    source_id: str = Field(index=True)
    platform: str = ""
    board_name: str = ""
    title: str
    body_markdown: str = ""
    body_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    item_count: int = 0
    needs_cookie: bool = False
    cookie_hint: str = ""
    status: str = "ok"
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class PromptTemplateRow(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    format: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    stage: str
    locked_system: str
    editable_instruction: str
    locked_hash: str
    required_phrases: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    variables: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    gates: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    version: int = 1


class Inspiration(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    level: str = "notion"  # notion / idea / concept / topic
    source_text: str
    candidates: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    format_hint: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class SwapPlan(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    project_id: Optional[str] = Field(default=None, index=True)
    source_doc_id: Optional[str] = None
    degree: str = "one"  # one / two
    mapping_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CrawlerSource(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    scope: str = ""
    interval: str = "12h"
    enabled: bool = False
    robots_ack: bool = False
    last_run_at: Optional[datetime] = None
    status: str = "idle"  # idle / running / ok / failed
    needs_cookie: bool = False
    last_error: Optional[str] = None
    last_item_count: int = 0
    cookie: Optional[str] = None  # 已加密存储（encrypt_secret）；明文仅在内存解密后使用


class AnalyticsSnapshot(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(index=True)
    views: int = 0
    favorites: int = 0
    retention: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class InboxLease(SQLModel, table=True):
    conversation_id: str = Field(primary_key=True)
    token: str
    expires_at: datetime = Field(index=True)


class InboxKey(SQLModel, table=True):
    conversation_id: str = Field(primary_key=True)
    dedupe_key: str = Field(primary_key=True)
    event_id: str


class AgentEvent(SQLModel, table=True):
    """Always-on 收件箱：每会话单活跃 worker，事件可去重/合并。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    conversation_id: str = Field(index=True)
    source: str = "web"  # web | feishu | timer | job_done | confirm | bot_delegate | bot_reply
    dedupe_key: Optional[str] = Field(default=None, index=True)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = "pending"  # pending | processing | done | failed | dropped
    # Private, admission-time delivery scope; NULL identifies pre-snapshot events.
    reply_delivery: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    owner_token: Optional[str] = None
    claimed_at: Optional[datetime] = None
    execution_started: bool = False
    # 数值越小优先级越高：0=用户私聊 10=群聊 20=Bot委派 30=例程
    priority: int = 10
    target_bot_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    processed_at: Optional[datetime] = None


class RunStepCounter(SQLModel, table=True):
    conversation_id: str = Field(primary_key=True)
    last_seq: int


class RunStep(SQLModel, table=True):
    """总编 / 子 Agent 执行步骤账本，供前端回放。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    conversation_id: str = Field(index=True)
    run_id: Optional[str] = Field(default=None, index=True)
    turn_id: Optional[str] = Field(default=None, index=True)
    seq: int = 0
    actor: str = "chief"  # chief | agent:<id>
    kind: str = "reply"  # thinking | tool_call | tool_result | dispatch | agent_status | bash | reply | watchdog
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class ThreadSubscription(SQLModel, table=True):
    """Worker 对 Thread 的订阅：同 thread 后续事件可直通，无需总编重判。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    thread_key: str = Field(index=True)  # project:<id> | artifact:<id> | feishu:<thread>
    conversation_id: str = Field(index=True)
    run_id: Optional[str] = Field(default=None, index=True)
    agent_id: Optional[str] = None
    project_id: Optional[str] = Field(default=None, index=True)
    status: str = "active"  # active | released | expired
    mode: str = "wake"  # wake=完成后唤醒总编 | observe=仅观察通知
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


# ─── Agent Eval（写作质量评测）───────────────────────────────────────────────


class EvalRubric(SQLModel, table=True):
    """二元评分细则：是/否/未知。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    key: str = Field(index=True, unique=True)
    name: str
    format: str = Field(default="*", index=True)  # * | manju | duanju | male_long | ...
    artifact_type: str = Field(default="manuscript", index=True)
    source: str = "nines"  # nines | kgm | charlie | w_list | deai | common
    source_ref: str = ""
    grader: str = "llm"  # code | llm | human
    code_gate: Optional[str] = None
    question: str
    guidance: str = ""
    severity: str = "major"  # veto | major | minor
    weight: float = 1.0
    w_codes: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    pass_example: str = ""
    fail_example: str = ""
    version: int = 1
    enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class EvalSuite(SQLModel, table=True):
    """评测集：黄金 / 回归 / 挑战 / 错题 / 巡检。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    kind: str = "process"  # e2e | process
    tier: str = Field(default="regression", index=True)  # golden | regression | challenge | bad_case | patrol
    format: str = Field(default="*", index=True)
    target_agent_id: Optional[str] = None
    pipeline: Optional[str] = None
    rubric_keys: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    trials_k: int = 1
    thresholds_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    description: str = ""
    enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class EvalCase(SQLModel, table=True):
    """评测用例 Task。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    suite_id: str = Field(index=True)
    title: str = ""
    input_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    reference_markdown: str = ""
    expected_behavior: str = ""
    label: str = "good"  # good | bad
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    origin: str = "course"  # course | production | manual | synthetic
    source_ref: str = ""
    enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class EvalRun(SQLModel, table=True):
    """一次评测运行（可含多个 Case × k Trial）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    suite_id: Optional[str] = Field(default=None, index=True)
    mode: str = Field(default="offline", index=True)  # offline | online_sample | patrol | pairwise | score_artifact
    variant_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    baseline_run_id: Optional[str] = None
    status: str = "queued"  # queued | running | succeeded | failed | cancelled
    metrics_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    gate_verdict: Optional[str] = None  # pass | blocked
    token_cost: int = 0
    job_id: Optional[str] = Field(default=None, index=True)
    progress_pct: int = 0
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None


class EvalTrial(SQLModel, table=True):
    """单次试验。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    eval_run_id: str = Field(index=True)
    case_id: Optional[str] = Field(default=None, index=True)
    trial_idx: int = 0
    agent_run_id: Optional[str] = None
    artifact_id: Optional[str] = None
    artifact_version_id: Optional[str] = None
    output_snapshot: str = ""
    passed: Optional[bool] = None
    score: float = 0.0
    cost: int = 0
    process_metrics: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class EvalJudgment(SQLModel, table=True):
    """单条 Rubric 判定。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    trial_id: Optional[str] = Field(default=None, index=True)
    artifact_version_id: Optional[str] = Field(default=None, index=True)
    artifact_id: Optional[str] = Field(default=None, index=True)
    rubric_key: str = Field(index=True)
    grader: str = "code"  # code | llm | human
    verdict: str = "unknown"  # pass | fail | unknown
    evidence_quote: str = ""
    reasoning: str = ""
    judge_model: Optional[str] = None
    annotator: Optional[str] = None
    blind: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class EvalCaseCandidate(SQLModel, table=True):
    """Case 池：线上信号待分诊。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    artifact_id: Optional[str] = Field(default=None, index=True)
    artifact_version: Optional[int] = None
    project_id: Optional[str] = Field(default=None, index=True)
    agent_run_id: Optional[str] = None
    signal: str = Field(index=True)  # rollback | regenerate | gate_fail | low_score | random_sample | user_flag_good | user_flag_bad | adopted_unedited
    attribution: Optional[str] = None
    attribution_suggestion: str = ""
    fix_suggestion: str = ""
    status: str = Field(default="triage", index=True)  # triage | to_golden | to_bad_case | to_rubric_fix | dismissed
    detail: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ArtifactFeedback(SQLModel, table=True):
    """段落/桥段级人工反馈：👍/👎 + 原因标签。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    artifact_id: str = Field(index=True)
    artifact_version: Optional[int] = None
    project_id: Optional[str] = Field(default=None, index=True)
    format: str = Field(default="*", index=True)
    artifact_type: str = Field(default="manuscript", index=True)
    span_start: int = 0
    span_end: int = 0
    span_text: str = ""
    polarity: str = Field(index=True)  # good | bad
    reason_tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # W07 等
    note: str = ""
    actor: str = "user"
    created_at: datetime = Field(default_factory=utcnow)


class PreferencePair(SQLModel, table=True):
    """A/B 或 best-of-N 偏好对，供 DPO 导出（不在本轮训练）。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    context_key: str = Field(index=True)  # project+step+inputHash
    prompt: str = ""
    chosen_text: str = ""
    rejected_text: str = ""
    reason_tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    source: str = Field(index=True)  # ab_pick | bestofn_pick | manual
    format: str = Field(default="*", index=True)
    project_id: Optional[str] = Field(default=None, index=True)
    artifact_id: Optional[str] = None
    chosen_artifact_id: Optional[str] = None
    rejected_artifact_id: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


# ─── Writing Ontology（Palantir 式运营层）────────────────────────────────


class OntoObject(SQLModel, table=True):
    """Ontology 对象实例；rid = ri.writing.{Type}.{uuid}"""

    rid: str = Field(primary_key=True)
    type_api_name: str = Field(index=True)
    project_id: str = Field(index=True)
    user_id: str = Field(default="", index=True)
    status: str = Field(default="draft", index=True)
    properties: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    content_hash: str = Field(default="", index=True)
    version: int = 1
    backing_artifact_id: Optional[str] = Field(default=None, index=True)
    scenario_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class OntoLink(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(index=True)
    link_type: str = Field(index=True)
    from_rid: str = Field(index=True)
    to_rid: str = Field(index=True)
    properties: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class OntoObjectVersion(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    rid: str = Field(index=True)
    version: int
    properties: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    content_hash: str = ""
    status: str = "draft"
    action_run_id: Optional[str] = Field(default=None, index=True)
    actor: str = "system"
    created_at: datetime = Field(default_factory=utcnow)


class OntoActionRun(SQLModel, table=True):
    """Action 审计日志：可回放、可审计。"""

    id: str = Field(default_factory=new_id, primary_key=True)
    run_rid: str = Field(default="", index=True)
    action_api_name: str = Field(index=True)
    project_id: str = Field(index=True)
    actor: str = "user"
    job_id: Optional[str] = Field(default=None, index=True)
    parameters: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    criteria: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    edits: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    side_effects: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    ok: bool = False
    error: Optional[str] = None
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None


class OntoScenario(SQLModel, table=True):
    rid: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    label: str = ""
    status: str = Field(default="open", index=True)  # open | merged | discarded
    base_rids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    forked_properties: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
