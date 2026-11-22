from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from sqlmodel import Session, select

from .gates import simple_hash
from .pricing import DEFAULT_MODEL_PRICING, upgrade_stale_deepseek_pricing
from .models import (
    AnalyticsSnapshot,
    AnalysisReport,
    Artifact,
    CrawlerSource,
    GraphSnapshot,
    Hotspot,
    Inspiration,
    KnowledgeDoc,
    MemoryFile,
    Project,
    PromptTemplateRow,
    ProviderConfig,
    ScheduledTask,
    SwapPlan,
    TaskProposal,
    TropeClip,
    UsageEvent,
    new_id,
    utcnow,
)
from .settings import get_settings

DEMO_USER = "00000000-0000-4000-8000-000000000001"
DEMO_PROJECT = "11111111-1111-4111-8111-111111111111"
DEMO_DOC = "22222222-2222-4222-8222-222222222222"
DEMO_GRAPH = "33333333-3333-4333-8333-333333333333"

# monorepo root: services/api/app/seed.py → parents[3]
_REPO_ROOT = Path(__file__).resolve().parents[3]
_PROMPT_CATALOG = _REPO_ROOT / "packages" / "prompt-registry" / "catalog.json"

def _load_prompt_catalog() -> dict:
    if not _PROMPT_CATALOG.exists():
        return {"prompts": [], "packs": [], "skillLinks": {}}
    return json.loads(_PROMPT_CATALOG.read_text(encoding="utf-8"))


def sync_prompts_from_catalog(session: Session) -> int:
    """从 prompt-registry/catalog.json 幂等 upsert 全部 Prompt（Skills 对齐的真相源）。"""
    catalog = _load_prompt_catalog()
    skill_links: dict = catalog.get("skillLinks") or {}
    n = 0
    for item in catalog.get("prompts") or []:
        pid = item["id"]
        locked = item.get("lockedSystem") or item.get("locked_system") or ""
        locked_hash = item.get("lockedHash") or item.get("locked_hash") or simple_hash(locked)
        row = session.get(PromptTemplateRow, pid)
        payload = dict(
            name=item.get("name") or pid,
            format=list(item.get("format") or []),
            stage=item.get("stage") or "",
            locked_system=locked,
            editable_instruction=item.get("editableInstruction")
            or item.get("editable_instruction")
            or "",
            locked_hash=locked_hash,
            required_phrases=list(
                item.get("requiredPhrases") or item.get("required_phrases") or []
            ),
            variables=list(item.get("variables") or []),
            gates=list(item.get("gates") or []),
            version=int(item.get("version") or 1),
        )
        # skill 路径写进 variables 元数据，便于 UI/调试（不改表结构）
        skill = skill_links.get(pid)
        if skill:
            meta_vars = [v for v in payload["variables"] if v.get("key") != "_skillPath"]
            meta_vars.append(
                {
                    "key": "_skillPath",
                    "label": "对应 Skill",
                    "type": "string",
                    "required": False,
                    "defaultValue": skill,
                }
            )
            payload["variables"] = meta_vars
        if row:
            for k, v in payload.items():
                setattr(row, k, v)
            session.add(row)
        else:
            session.add(PromptTemplateRow(id=pid, **payload))
        n += 1
    session.commit()
    return n


def seed_if_empty(session: Session) -> None:
    existing = session.exec(select(Project).limit(1)).first()
    if existing:
        return
    settings = get_settings()
    default_model = settings.effective_minimax_model

    project = Project(
        id=DEMO_PROJECT,
        user_id=DEMO_USER,
        title="重生之商业帝国（演示）",
        format="manju",
        genre_tags=["男频", "都市", "重生"],
        market="cn",
        stage="S2_HOOK_SELECT",
        status="active",
        progress={"S0_SETUP": 1, "S1_HOOK_BATCH": 1},
        cover_meta={"logline": "重生回到高考前夜，用信息差改写命运", "benchmark": "某爆款都市漫剧"},
        prompt_pack_id="pack.manju.default",
        token_used=12840,
    )
    session.add(project)

    batch_id = "batch-demo-01"
    hooks = [
        {
            "title": "高考前夜的系统",
            "titleHook": "高考前夜，系统让我看见十年后的破产",
            "coreHook": "重生男主在高考前夜获得「命运回放」系统，必须在三年内阻止家族破产。",
            "motivation": "救家族 + 证明自己",
            "crisis": "系统倒计时与宿敌布局冲突",
            "openingStructure": "日常崩坏→系统唤醒→立下军令状",
            "openingBeats": ["教室铃响", "系统弹窗", "父亲电话"],
            "tags": ["重生", "系统"],
            "scores": {"empathy": 8, "thrill": 7, "diff": 6, "motivation": 9, "mainline": 8},
            "favorited": True,
            "riskFlags": [],
        },
        {
            "title": "闪婚继承人",
            "titleHook": "闪婚当晚，他发现新娘是商业死敌的女儿",
            "coreHook": "为拿继承权假结婚，婚礼夜揭开身份对峙。",
            "motivation": "",
            "crisis": "联姻合同与真情冲突",
            "openingStructure": "",
            "openingBeats": ["婚礼", "身份曝光"],
            "tags": ["甜宠", "商战"],
            "scores": {"empathy": 6, "thrill": 8, "diff": 5, "motivation": 4, "mainline": 6},
            "favorited": False,
            "riskFlags": [],
        },
    ]
    # pad to 10 candidates
    for i in range(3, 11):
        hooks.append(
            {
                "title": f"候选梗 {i}",
                "titleHook": f"第{i}条标题钩：隐藏身份被当众揭穿",
                "coreHook": f"演示用核心梗正文 #{i}，含单元冲突与反转空间。",
                "motivation": "复仇" if i % 2 == 0 else "守护",
                "crisis": f"危机节点 {i}",
                "openingStructure": "误会→打脸→立誓",
                "openingBeats": ["开场打脸", "反转"],
                "tags": ["都市"],
                "scores": {
                    "empathy": 5 + (i % 4),
                    "thrill": 5 + (i % 5),
                    "diff": 4 + (i % 3),
                    "motivation": 6,
                    "mainline": 7,
                },
                "favorited": False,
                "riskFlags": ["边缘题材"] if i == 9 else [],
            }
        )

    for idx, h in enumerate(hooks, start=1):
        body = {k: v for k, v in h.items() if k != "title"}
        session.add(
            Artifact(
                project_id=DEMO_PROJECT,
                type="core_hook",
                title=h["title"],
                status="candidate",
                body_markdown=h["coreHook"],
                body_json=body,
                batch_id=batch_id,
            )
        )

    for ep in range(1, 11):
        session.add(
            Artifact(
                project_id=DEMO_PROJECT,
                type="episode_outline",
                title=f"第{ep}集大纲",
                status="draft",
                body_markdown=f"第{ep}集：冲突升级，结尾留钩。",
                body_json={
                    "episodeNo": ep,
                    "title": f"第{ep}集",
                    "summary": f"演示分集摘要 {ep}",
                    "beats": [f"情节点A{ep}", f"情节点B{ep}"],
                    "hookAtEnd": ep != 3,
                    "emotionPeak": (ep % 5) - 2,
                },
            )
        )

    for ep in range(1, 4):
        session.add(
            Artifact(
                project_id=DEMO_PROJECT,
                type="manuscript",
                title=f"第{ep}集正文",
                status="draft" if ep < 3 else "adopted",
                body_markdown=f"【分镜】教室\n【台词】……第{ep}集演示正文",
                body_json={
                    "episodeNo": ep,
                    "scenes": [
                        {"visual": "教室全景", "dialogue": f"你以为这是结束？第{ep}集才刚开始。"},
                    ],
                    "wordCount": 2200 + ep * 100,
                    "hookAtEnd": True,
                    "queueStatus": "adopted" if ep == 3 else "review",
                },
            )
        )

    session.add(
        Project(
            user_id=DEMO_USER,
            title="短剧选题草稿",
            format="duanju",
            genre_tags=["女频", "虐恋"],
            market="cn",
            stage="S1_TOPIC_CONFLICT",
            status="active",
            progress={},
            cover_meta={"logline": "假千金归来"},
            prompt_pack_id="pack.duanju.default",
            token_used=320,
        )
    )

    report_id = new_id()
    session.add(
        KnowledgeDoc(
            id=DEMO_DOC,
            title="对标爆款·都市重生.txt",
            source="上传",
            author="未知",
            doc_type="script_manju",
            gender_channel="male",
            tags=["都市", "重生", "男频"],
            status="ready",
            word_count=86000,
            storage_uri="minio://demo/doc1.txt",
            hash="sha256:demo",
            analysis_report_ids=[report_id],
            graph_id=DEMO_GRAPH,
            folder_id="folder-root",
            user_id=DEMO_USER,
        )
    )
    session.add(
        AnalysisReport(
            id=report_id,
            doc_id=DEMO_DOC,
            report_type="dissect_params",
            title="拆书参数报告",
            body_markdown=(
                "## 1 基本信息\n- 题材：都市重生\n- 类型：漫剧对标\n- 梗概：重生回到被背叛当夜，先夺遗产再拆阴谋\n\n"
                "## 2 期待感\n- 大期待：主角能否翻盘并清算旧仇\n- 小期待：第一夜能否保住股权\n\n"
                "## 3 故事设定\n- 背景：现代都市商业圈\n- 主角：林川\n\n"
                "## 4 故事脉络\n- 重生夜反击→家族局→商业战→情感反转\n\n"
                "## 5 核心冲突\n- 主角 vs 家族腐败\n- 真相 vs 谎言\n- 旧情 vs 清醒\n\n"
                "## 6 情绪曲线\n紧张→迷茫→绝望→伤感→微光希望→有点希望\n\n"
                "## 7～11\n人物关系 / 反转 / 起承转合 / 七步法 / 写实节奏"
            ),
            body_json={
                "schemaVersion": "nines-2.md/1",
                "purpose": "full_params",
                "textCheck": {
                    "encoding": "utf8_windows",
                    "lineEnding": "crlf",
                    "cleanedHierarchyNoise": True,
                },
                "basic": {
                    "synopsis": "重生回到被背叛当夜，先夺遗产再拆阴谋",
                    "genre": "都市重生",
                    "typeLabel": "漫剧对标",
                    "approxWords": 86000,
                },
                "expectations": {
                    "big": "主角能否翻盘并清算旧仇",
                    "small": ["第一夜保住股权", "当众打脸白月光"],
                },
                "setting": {
                    "background": "现代都市商业圈",
                    "protagonist": "林川",
                    "supporting": ["苏晚", "天启集团董事会"],
                },
                "storyline": {
                    "coreContent": "重生夜反击→家族局→商业战→情感反转",
                    "note": "此处「核心内容」不是核心梗定义",
                },
                "conflicts": ["主角与家族腐败斗争", "真相与谎言", "旧情与清醒"],
                "emotionCurve": [
                    {"beatLabel": "醒来", "value": -6, "note": "紧张"},
                    {"beatLabel": "发现背叛", "value": -8, "note": "绝望"},
                    {"beatLabel": "第一次反击", "value": 2, "note": "微光"},
                    {"beatLabel": "当众打脸", "value": 7, "note": "爽点"},
                ],
                "relationships": [
                    {"from": "林川", "to": "苏晚", "bond": "旧情破裂后的冷距离"},
                    {"from": "林川", "to": "天启集团", "bond": "继承与夺权"},
                ],
                "twists": ["表面植物人实为布局", "白月光才是推手"],
                "qiChengZhuanHe": {
                    "qi": "重生夜发现被夺权",
                    "cheng": "假装不知情收集证据",
                    "zhuan": "董事会反杀",
                    "he": "清算旧仇并立新秩序",
                    "chapterRange": "1～5 集",
                },
                "sevenSteps": {
                    "goal": "夺回控制权并清算背叛",
                    "obstacle": "股权已转移、证据被毁",
                    "action": "装傻→套话→夺章→开会",
                    "result": "第一次夺权失败被反制",
                    "accident": "意外发现录像备份",
                    "twist": "用备份反杀董事会",
                    "ending": "暂时稳住局面，更大阴谋浮现",
                    "reverseValidate": True,
                },
                "rhythmStyle": {"rhythm": "先抑后扬，单元内三起三落", "style": "写实偏快"},
                "unitStories": [
                    {
                        "id": "u1",
                        "title": "重生夜反击",
                        "scale": "unit",
                        "chapterRange": "1～3 集",
                        "purpose": "开篇钩与期待感",
                        "worthDeepDissect": True,
                        "summary": "醒来发现背叛，当晚完成第一次小反杀",
                    },
                    {
                        "id": "u2",
                        "title": "家族局",
                        "scale": "unit",
                        "chapterRange": "4～7 集",
                        "purpose": "故事线",
                        "worthDeepDissect": False,
                        "summary": "董事会与旁支施压",
                    },
                ],
                "extractedHooks": [
                    {
                        "kind": "core_hook",
                        "category": "thrill",
                        "size": "unit",
                        "titleHook": "重生当夜先夺遗产",
                        "coreHook": "被背叛者带信息差反击，情绪：憋屈→布局→打脸→新危机",
                        "emotionChain": [
                            {"label": "憋屈", "side": "hurt", "intensity": -6},
                            {"label": "布局", "side": "shared", "intensity": 1},
                            {"label": "打脸", "side": "reader", "intensity": 8},
                        ],
                        "abstractions": [
                            {"concrete": "董事会会议室", "abstract": "公共权威场合"}
                        ],
                        "tags": ["重生", "打脸"],
                        "favorited": True,
                        "riskFlags": [],
                        "plotCardSteps": [],
                        "conflicts": [],
                        "openingBeats": [],
                    }
                ],
                "proofread": {
                    "comparedWithSource": True,
                    "rounds": 2,
                    "issues": ["AI 初拆漏掉二次反转，已人工补"],
                },
                "favoriteWorthDeep": ["u1"],
                "worldSetting": "现代都市",
            },
        )
    )
    session.add(
        GraphSnapshot(
            id=DEMO_GRAPH,
            doc_id=DEMO_DOC,
            nodes=[
                {"id": "n1", "label": "林川", "type": "Character"},
                {"id": "n2", "label": "苏晚", "type": "Character"},
                {"id": "n3", "label": "天启集团", "type": "Faction"},
            ],
            edges=[
                {"id": "e1", "source": "n1", "target": "n2", "relationType": "暗恋", "strength": 0.7},
                {"id": "e2", "source": "n1", "target": "n3", "relationType": "继承", "strength": 0.9},
            ],
        )
    )
    session.add(
        TropeClip(
            name="当众打脸反转",
            summary="弱者被羞辱后立刻用实力反杀，情绪峰值高。",
            source_doc_id=DEMO_DOC,
            source_locator="ch12",
            tags=["打脸", "爽点"],
            emotion_peak=8,
            applicable_genres=["都市", "校园"],
            swap_hints="可置换为职场汇报/家族宴会",
            favorited=True,
        )
    )
    session.add(
        TropeClip(
            name="假结婚真动心",
            summary="契约婚姻中逐渐产生真实情感。",
            source_doc_id=DEMO_DOC,
            tags=["甜宠"],
            emotion_peak=6,
            applicable_genres=["女频", "都市"],
            favorited=False,
        )
    )

    session.add(
        MemoryFile(
            path="/memories/user/preferences.md",
            user_id=DEMO_USER,
            content="# 偏好\n- 男频都市\n- 厌恶无脑打脸堆砌",
            hash="m1",
        )
    )
    session.add(
        MemoryFile(
            path=f"/memories/projects/{DEMO_PROJECT}/PROJECT.md",
            user_id=DEMO_USER,
            project_id=DEMO_PROJECT,
            content="# 项目记忆\n当前锁定核心梗方向：重生系统+家族危机",
            hash="m2",
        )
    )
    session.add(
        MemoryFile(
            path=f"/memories/projects/{DEMO_PROJECT}/hypothesis:rival.md",
            user_id=DEMO_USER,
            project_id=DEMO_PROJECT,
            content="hypothesis: 宿敌可能是前世合伙人",
            is_hypothesis=True,
            hash="m3",
        )
    )

    session.add(
        TaskProposal(
            type="scan",
            message="检测到知识库有 1 篇文档尚未推送到写作台，建议拆书后导入漫剧项目。",
            project_id=DEMO_PROJECT,
            actions=[
                {"label": "打开知识库文档", "needsApproval": False, "actionId": "open_kb"},
                {"label": "推送到当前项目", "needsApproval": True, "actionId": "push_kb"},
            ],
        )
    )
    session.add(
        TaskProposal(
            type="suggest",
            message="第 3 集大纲缺集尾钩子，建议补钩后再进入正文队列。",
            project_id=DEMO_PROJECT,
            actions=[{"label": "跳转到大纲", "needsApproval": False, "actionId": "goto_outline"}],
        )
    )

    session.add(
        UsageEvent(
            user_id=DEMO_USER,
            project_id=DEMO_PROJECT,
            agent_id="CoreHookAgent",
            model=default_model,
            prompt_tokens=4200,
            completion_tokens=8600,
            cache_hit_tokens=2600,
            cache_miss_tokens=1600,
            cost_est=0.12,
            duration_ms=18400,
        )
    )
    session.add(
        UsageEvent(
            user_id=DEMO_USER,
            project_id=DEMO_PROJECT,
            agent_id="EpisodeOutlineAgent",
            model=default_model,
            prompt_tokens=2100,
            completion_tokens=3900,
            cache_hit_tokens=1300,
            cache_miss_tokens=800,
            cost_est=0.05,
            duration_ms=9200,
        )
    )

    session.add(
        ProviderConfig(
            name="MiniMax",
            base_url=settings.effective_minimax_base_url,
            api_key_enc="",
            api_key_masked="未配置",
            models=[default_model],
            selected_model=default_model,
            enabled=True,
            is_default=True,
            pricing={"MiniMax-M3.1-Flash": {"input": 1.0, "cachedInput": 0.5, "output": 4.0}},
        )
    )
    session.add(
        ProviderConfig(
            name="DeepSeek",
            base_url="https://api.deepseek.com",
            api_key_enc="",
            api_key_masked="未配置",
            models=["deepseek-flash", "deepseek-v4-pro"],
            selected_model="deepseek-flash",
            enabled=False,
            is_default=False,
            pricing={
                "deepseek-flash": dict(DEFAULT_MODEL_PRICING["deepseek-flash"]),
                "deepseek-v4-pro": dict(DEFAULT_MODEL_PRICING["deepseek-v4-pro"]),
            },
        )
    )

    for t in [
        ScheduledTask(
            id="colleague.scan_gaps",
            name="同事缺口扫描",
            cron_or_interval="30m",
            enabled=True,
            owner_scope="user",
            description="扫描项目缺口并写 TaskProposal",
            next_run_at=utcnow(),
        ),
        ScheduledTask(
            id="hotspot.refresh",
            name="热点摘要刷新",
            cron_or_interval="12h",
            enabled=False,
            owner_scope="system",
            description="合规榜单摘要（默认关）",
            payload_template={"type": "hotspot.refresh"},
        ),
        ScheduledTask(
            id="crawler.run",
            name="定时抓取公开榜单",
            cron_or_interval="12h",
            enabled=False,
            owner_scope="system",
            description="对已启用且确认 robots 的数据源做摘要级抓取（默认关）",
            payload_template={"type": "crawler.run"},
        ),
        ScheduledTask(
            id="usage.rollup",
            name="用量日汇总",
            cron_or_interval="1d",
            enabled=True,
            owner_scope="system",
            payload_template={"type": "usage.rollup"},
        ),
        ScheduledTask(
            id="mem.dreams.nightly",
            name="记忆梦境巩固",
            cron_or_interval="1d",
            enabled=False,
            owner_scope="system",
            description="扫描短期记忆提升长期 bible/decisions（默认关；启用需配置 project）",
            payload_template={
                "type": "agent.run",
                "agentId": "mem.dreams",
                "input": {"window_hours": 24},
            },
            next_run_at=utcnow(),
        ),
    ]:
        session.add(t)

    for i, (title, genre, summary) in enumerate(
        [
            ("都市重生题材热度回升", "都市", "近 7 日都市重生短剧/漫剧讨论量上升，偏「信息差打脸」。"),
            ("女频追妻火葬场升温", "女频", "追妻/悔悟类榜单占比抬头，付费点集中在真相揭开。"),
            ("脑洞异能新书上榜", "脑洞", "系统流/异能在新书榜占位上升，开篇强冲突占比高。"),
            ("甜宠下沉市场回暖", "女频", "甜宠题材收藏率回升，强钩子前 3 集更吃香。"),
        ]
    ):
        session.add(
            Hotspot(
                title=title,
                genre=genre,
                source="公开榜摘要",
                summary=summary,
                fetched_at=utcnow() - timedelta(days=3 - i),
            )
        )

    sync_prompts_from_catalog(session)

    session.add(
        Inspiration(
            user_id=DEMO_USER,
            level="topic",
            source_text="高考前夜，系统让我看见十年后的破产",
            tags=["重生", "系统"],
            format_hint="manju",
            candidates=[
                {
                    "title": "高考前夜，系统让我看见十年后的破产",
                    "logline": "重生者 + 命运回放系统，三年内阻止家族破产",
                    "scores": {"empathy": 8, "thrill": 7, "shell": 8, "market": 9},
                }
            ],
        )
    )

    for src in _default_crawler_sources():
        session.add(src)

    session.add(
        AnalyticsSnapshot(
            project_id=DEMO_PROJECT,
            views=5200,
            favorites=480,
            retention={"1集": 0.72, "3集": 0.55, "10集": 0.34},
            meta={"favRate": "收藏/点击 ≈ 9.2%", "hint": "收藏率低于 5% 需重看金手指与开局钩子"},
        )
    )

    session.add(
        SwapPlan(
            user_id=DEMO_USER,
            project_id=DEMO_PROJECT,
            source_doc_id=DEMO_DOC,
            degree="one",
            mapping_json=[
                {"key": "background", "label": "背景", "source": "现代都市", "target": "仙侠界", "swappable": True},
                {"key": "character", "label": "人物", "source": "破产公子", "target": "废灵根弟子", "swappable": True},
                {"key": "prop", "label": "道具", "source": "家族印章", "target": "残破玉简", "swappable": True},
                {"key": "event", "label": "事件（故事）", "source": "家族破产后翻盘", "target": "", "swappable": False},
                {"key": "structure", "label": "结构", "source": "第一人称线性", "target": "第一人称线性", "swappable": True},
                {"key": "subject", "label": "主体（价值观）", "source": "亲情与尊严", "target": "亲情与尊严", "swappable": False},
            ],
        )
    )

    session.commit()


def _default_crawler_sources() -> list[CrawlerSource]:
    """九格课：番茄/晋江/飞卢/七猫/起点 + 红果漫剧信号。"""
    return [
        CrawlerSource(
            id="fanqie",
            name="番茄小说公开榜",
            scope="公开阅读榜：书名/作者/简介摘要（九格扫榜主源）",
            interval="12h",
            enabled=False,
            robots_ack=False,
        ),
        CrawlerSource(
            id="jinjiang",
            name="晋江公开排行榜",
            scope="公开榜：书名/作者/频道题材/连载状态",
            interval="12h",
            enabled=False,
            robots_ack=False,
        ),
        CrawlerSource(
            id="feilu",
            name="飞卢公开点击榜",
            scope="公开榜书名摘要（男频/同人综漫信号）",
            interval="12h",
            enabled=False,
            robots_ack=False,
        ),
        CrawlerSource(
            id="qimao",
            name="七猫公开排行",
            scope="男女频大热榜公开 SSR 摘要（无需 Cookie）",
            interval="12h",
            enabled=False,
            robots_ack=False,
            needs_cookie=False,
        ),
        CrawlerSource(
            id="qidian",
            name="起点月票榜",
            scope="移动端月票榜公开 SSR 摘要（无需 Cookie）",
            interval="12h",
            enabled=False,
            robots_ack=False,
            needs_cookie=False,
        ),
        CrawlerSource(
            id="hongguo",
            name="红果/抖音漫剧热榜",
            scope="红果官网漫剧热播榜结构化摘要（无需 Cookie）",
            interval="12h",
            enabled=False,
            robots_ack=False,
            needs_cookie=False,
        ),
        CrawlerSource(
            id="manual",
            name="手动录入榜单/社会热点",
            scope="本地手动录入，不发起网络请求",
            interval="—",
            enabled=True,
            robots_ack=True,
            last_run_at=utcnow(),
            status="ok",
        ),
    ]


def ensure_minimax_default_provider(session: Session) -> dict[str, object]:
    """Bootstrap MiniMax, preserving explicit database provider choices on restart.

    Environment settings fill missing fields only. Legacy duplicate MiniMax rows
    and DeepSeek rows accidentally pointing to MiniMax are repaired narrowly.
    """
    from .crypto import decrypt_secret, encrypt_secret, mask_secret

    settings = get_settings()
    provider = (settings.llm_default_provider or "minimax").lower()
    if provider not in {"minimax", "mini_max"}:
        return {"skipped": True, "reason": f"llm_default_provider={provider}"}

    model = settings.effective_minimax_model
    base_url = settings.effective_minimax_base_url
    api_key = settings.effective_minimax_api_key
    rows = list(session.exec(select(ProviderConfig)).all())
    minimax_rows = [r for r in rows if (r.name or "").strip().lower() in {"minimax", "mini_max"}]

    def _has_real_key(row: ProviderConfig) -> bool:
        plain = decrypt_secret(row.api_key_enc or "")
        return bool(plain) and plain != "demo"

    # An explicitly selected row owns the endpoint/model/enabled preferences;
    # a legacy duplicate can supply its missing secret without replacing them.
    keep = next((r for r in minimax_rows if r.is_default), None)
    if keep is None:
        keep = next((r for r in minimax_rows if _has_real_key(r)), None)
    if keep is None and minimax_rows:
        keep = minimax_rows[0]
    if keep is None:
        keep = ProviderConfig(
            name="MiniMax", base_url=base_url, models=[model],
            selected_model=model, enabled=True, is_default=False,
            api_key_enc="", api_key_masked="未配置",
        )
        rows.append(keep)
    if not _has_real_key(keep):
        donor = next((r for r in minimax_rows if _has_real_key(r)), None)
        if donor is not None:
            keep.api_key_enc = donor.api_key_enc
            keep.api_key_masked = donor.api_key_masked
        elif api_key:
            keep.api_key_enc = encrypt_secret(api_key)
            keep.api_key_masked = mask_secret(api_key)
    duplicate_ids = {r.id for r in minimax_rows if r.id != keep.id}
    for duplicate in minimax_rows:
        if duplicate.id in duplicate_ids:
            session.delete(duplicate)
    rows = [r for r in rows if r.id not in duplicate_ids]

    keep.name = "MiniMax"
    if not (keep.base_url or "").strip():
        keep.base_url = base_url
    models = [str(m) for m in (keep.models or []) if m]
    if not (keep.selected_model or "").strip():
        keep.selected_model = models[0] if models else model
    if keep.selected_model and keep.selected_model not in models:
        models.append(keep.selected_model)
    keep.models = models
    if not keep.pricing:
        keep.pricing = {"MiniMax-M3.1-Flash": {"input": 1.0, "cachedInput": 0.5, "output": 4.0}}
    session.add(keep)

    for other in rows:
        # Repair only the known cross-provider URL mistake. Keep a legitimate
        # custom DeepSeek model, secret, enabled state and default selection.
        if (other.name or "").strip().lower() == "deepseek" and "minimax" in (other.base_url or "").lower():
            other.base_url = settings.deepseek_base_url or "https://api.deepseek.com"
            if not other.selected_model or other.selected_model.lower().startswith("minimax"):
                other.selected_model = settings.deepseek_model
                models_ds = [str(m) for m in (other.models or []) if m]
                if other.selected_model and other.selected_model not in models_ds:
                    models_ds.insert(0, other.selected_model)
                other.models = models_ds
            session.add(other)

    # Startup defaults apply only when no usable enabled default was saved.
    chosen = next((r for r in rows if r.is_default and r.enabled
                   and (r.base_url or "").strip() and (r.selected_model or "").strip()), None)
    if chosen is None and keep.enabled:
        chosen = keep
    if chosen is not None:
        for row in rows:
            row.is_default = row.id == chosen.id
            session.add(row)
    session.commit()
    session.refresh(keep)
    active = chosen or keep
    return {
        "skipped": False,
        "defaultProviderId": chosen.id if chosen else None,
        "model": active.selected_model,
        "baseUrl": active.base_url,
        "configured": _has_real_key(active),
    }


def ensure_deepseek_peak_pricing(session: Session) -> int:
    """把仍等于旧默认 DeepSeek 单价的服务商配置升到官方高峰价；自定义价不动。"""
    changed = 0
    for row in session.exec(select(ProviderConfig)).all():
        pricing = getattr(row, "pricing", None)
        if not isinstance(pricing, dict) or not pricing:
            continue
        upgraded = upgrade_stale_deepseek_pricing(pricing)
        # 保留非 triplet 的原始条目，只替换可识别模型价。
        new_pricing = dict(pricing)
        dirty = False
        for model, rate in upgraded.items():
            prev = pricing.get(model)
            if not isinstance(prev, dict):
                continue
            try:
                old = {f: float(prev[f]) for f in ("input", "cachedInput", "output")}
            except (KeyError, TypeError, ValueError):
                continue
            if any(abs(old[f] - rate[f]) > 1e-9 for f in old):
                new_pricing[model] = dict(rate)
                dirty = True
        if dirty:
            row.pricing = new_pricing
            session.add(row)
            changed += 1
    if changed:
        session.commit()
    return changed


def ensure_reference_data(session: Session) -> None:
    """幂等补种参考数据（不依赖主种子是否已跑过）。"""
    for src in _default_crawler_sources():
        existing = session.get(CrawlerSource, src.id)
        if not existing:
            session.add(src)
        elif src.id in {"qimao", "qidian", "hongguo"}:
            # 三个来源已改为公开 SSR；保留运行状态，仅清除旧的 Cookie 强依赖标记。
            existing.scope = src.scope
            existing.needs_cookie = False
            session.add(existing)
    session.commit()
    try:
        ensure_minimax_default_provider(session)
    except Exception:  # noqa: BLE001
        pass
    try:
        ensure_deepseek_peak_pricing(session)
    except Exception:  # noqa: BLE001
        pass
    sync_prompts_from_catalog(session)
    try:
        from .bot_registry import seed_system_bots

        seed_system_bots(session)
    except Exception:  # noqa: BLE001
        pass
    try:
        from .eval.seed import ensure_eval_seeds

        ensure_eval_seeds(session)
    except Exception:  # noqa: BLE001
        pass
