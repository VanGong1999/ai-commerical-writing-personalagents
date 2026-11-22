from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.llm_service import chat_completion, resolve_default_model
from app.models import AnalysisReport, GraphSnapshot, KnowledgeDoc, TropeClip, Job, UsageEvent, new_id
from app.queue import is_cancelled, publish_job_event
from app.settings import get_settings
from app.source_paths import read_source_text
from kb_retrieval import index_document
from worker_handlers import JobCancelledError, REPORT_TYPES, _load_agent_skill_body, _parse_json_object

logger = logging.getLogger("job-worker.kb")


async def _kb_chat(session: Session, job: Job, stage: str, messages: list[dict], **kwargs: Any) -> Any:
    """Persist actual returned usage before parsing, including rejected responses.

    run_id links to the background Job; its payload contains the source docId.
    cost_est remains unset/zero: provider token counts are not a supplier bill.
    """
    selected_model = kwargs.get("model") or resolve_default_model()
    if "minimax-m3.1" in selected_model.lower():
        # MiniMax defaults to max effort; reasoning shares the output budget.
        kwargs["extra_body"] = {"reasoning_effort": "low", **(kwargs.get("extra_body") or {})}
    started = time.monotonic()
    result = await chat_completion(messages, **kwargs)
    session.add(UsageEvent(user_id=job.user_id, project_id=job.project_id, run_id=job.id,
        agent_id=f"kb.{stage}", model=getattr(result, "model", None) or kwargs.get("model") or resolve_default_model(),
        prompt_tokens=getattr(result, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(result, "completion_tokens", 0) or 0,
        cache_hit_tokens=getattr(result, "cache_hit_tokens", 0) or 0,
        cache_miss_tokens=getattr(result, "cache_miss_tokens", 0) or 0,
        duration_ms=int((time.monotonic() - started) * 1000)))
    session.commit()
    publish_job_event(job.id, {"type": "usage", "stage": stage, "docId": (job.payload or {}).get("docId"),
        "model": getattr(result, "model", None) or kwargs.get("model"),
        "promptTokens": getattr(result, "prompt_tokens", 0) or 0,
        "completionTokens": getattr(result, "completion_tokens", 0) or 0,
        "contentChars": len(result.content),
        "costStatus": "unknown", "costNote": "供应商未返回账单金额；用量已记录，0不代表免费"})
    raw = getattr(result, "raw", {}) or {}
    reason = ((raw.get("choices") or [{}])[0]).get("finish_reason")
    if reason in {"length", "content_filter"}:
        raise ValueError(f"模型响应被截断或过滤 ({reason})，未采纳为分析结果；请重试")
    return result


def _strict_json(text: str) -> dict[str, Any]:
    data = _parse_json_object(text)
    if not data or "raw" in data:
        raise ValueError("模型未返回完整 JSON，未采纳为分析结果；请重试")
    return data

# Skill 报告类型 id → 落库 report_type（兼容历史 redline_report）
_SKILL_TYPE_ALIASES = {
    "redline_report": "redline",
    "unit_story": "unit_cut",
}


UPLOAD_DIR = Path(__file__).resolve().parents[1] / "api" / "data" / "uploads"


def _extract_text_from_storage(doc: KnowledgeDoc) -> str:
    """Read real source content; missing files are errors, never title stand-ins."""
    uri = doc.storage_uri or ""
    if uri.startswith("inline:"):
        text = uri[len("inline:") :]
        if doc.word_count and doc.word_count > len(text):
            raise ValueError("历史内联原文疑似被截断，请重新上传完整源文件；不能自动恢复缺失尾部")
    elif uri.startswith("minio://"):
        from minio_store import download_bytes

        bucket, separator, object_name = uri[len("minio://") :].partition("/")
        if not separator or bucket != get_settings().minio_bucket:
            raise ValueError("原文对象存储地址无效")
        text = download_bytes(object_name).decode("utf-8")
    elif uri.startswith("file://"):
        text = _read_path(Path(uri[7:]))
    elif uri and "://" not in uri:
        text = _read_path(Path(uri))
    else:
        raise ValueError("原文存储地址缺失或不受支持，请重新上传源文件")
    if not text.strip():
        raise ValueError("未提取到原文正文，请检查源文件格式或先完成 OCR 后重新上传")
    return text


def _read_path(path: Path) -> str:
    return read_source_text(path)

def _persist_local_source(doc_id: str, text: str) -> Path:
    """Atomic UTF-8 source, independent of optional object storage availability.

    Original uploads are retained; identifiers never become filesystem paths.
    """
    root = UPLOAD_DIR.resolve()
    root.mkdir(parents=True, exist_ok=True)
    identity = hashlib.sha256(doc_id.encode()).hexdigest()[:24]
    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    target = root / f"kb-{identity}-{content_hash[:16]}.txt"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=root, delete=False) as output:
            temporary = Path(output.name)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return target


def _excerpt_coverage(doc: KnowledgeDoc, text: str, limit: int) -> dict[str, Any]:
    excerpt = text[:limit]
    chapters = re.findall(r"^\s*((?:第[^\n]{1,20}[章回节集卷话]|Chapter\s+\d+)[^\n]{0,60})", excerpt, re.MULTILINE)
    return {
        "docId": doc.id, "scope": "source_text" if len(excerpt) == len(text) else "prefix_excerpt",
        "complete": len(excerpt) == len(text), "offsetUnit": "unicode_codepoint",
        "startChar": 0, "endChar": len(excerpt), "sourceChars": len(text),
        "sourceSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "excerptSha256": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
        "chapterHeadings": [heading.strip() for heading in chapters],
    }


def chunk_text(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    text = re.sub(r"\r\n?", "\n", text).strip()
    if not text:
        return []
    chunks: list[str] = []
    i = 0
    while i < len(text):
        chunks.append(text[i : i + size])
        i += max(1, size - overlap)
    return chunks


async def ingest_document(session: Session, doc: KnowledgeDoc, job: Job) -> None:
    text = _extract_text_from_storage(doc)
    doc.word_count = len(text)
    doc.hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    # Persist complete cleaned source before optional backups/indexing.
    local_source = _persist_local_source(doc.id, text)
    doc.storage_uri = str(local_source)
    # MinIO is an optional backup; local primary keeps API reads available.
    try:
        from minio_store import upload_bytes

        object_name = f"kb/{doc.id}/source.txt"
        upload_bytes(object_name, text.encode("utf-8"), content_type="text/plain")
    except Exception as exc:  # noqa: BLE001
        logger.warning("MinIO upload failed; complete local source retained: %s", type(exc).__name__)

    # 持久化全文检索索引（FTS5 bigram + 文档向量），搜索主路径，不依赖 Milvus
    try:
        result = index_document(doc.id, doc.title, text)
        publish_job_event(
            job.id,
            {"type": "token", "text": f"已建立全文检索索引（{result.get('segments')} 个切片）。\n"},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("persistent index failed: %s", exc)
        raise RuntimeError("全文索引失败，原文已保留，请重试入库") from exc

    # try milvus embed（可选 heavy 路径）
    chunks = chunk_text(text)
    try:
        from vector_store import upsert_chunks

        await upsert_chunks(doc.id, chunks)
        publish_job_event(job.id, {"type": "token", "text": f"已向量化 {len(chunks)} 个切片。\n"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("vector upsert skipped: %s", exc)
        publish_job_event(job.id, {"type": "token", "text": f"向量化跳过：{exc}\n"})

    # kb.auto_tag：入库后自动题材/频向标签（失败不阻断）
    try:
        tag_result = await _kb_chat(session, job, "auto_tag", 
            [
                {
                    "role": "system",
                    "content": (
                        "你是 kb.auto_tag Agent。根据文摘输出 JSON："
                        "{tags: string[]（3-8个：题材/频向/桥段/风格）}。"
                        "禁止空标签；禁止复述全文。"
                    ),
                },
                {
                    "role": "user",
                    "content": f"标题：{doc.title}\n摘录：\n{text[:4000]}",
                },
            ],
            temperature=0.3,
            max_tokens=400,
        )
        parsed = _parse_json_object(tag_result.content)
        tags = [str(t).strip() for t in (parsed.get("tags") or []) if str(t).strip()][:12]
        if tags:
            existing = list(doc.tags or [])
            merged = list(dict.fromkeys([*existing, *tags]))
            doc.tags = merged
            publish_job_event(job.id, {"type": "token", "text": f"自动打标：{', '.join(tags)}\n"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("auto_tag skipped: %s", exc)

    doc.status = "ready"
    session.add(doc)
    session.commit()


def _check_cancelled(job: Job) -> None:
    if is_cancelled(job.id):
        raise JobCancelledError("知识库分析已取消；已完成的分段摘要保留，可重新发起以继续")


_DIGEST_VERSION = "kb-full-digest-v2"
_FULL_FRAGMENT_CHARS = 8000
_FINAL_DIGEST_CHARS = 7000


async def _full_analysis_context(session: Session, doc: KnowledgeDoc, job: Job, text: str) -> tuple[str, dict[str, Any], list[dict[str, Any]], str]:
    """Opt-in bounded sequential map/reduce, with each completed node durable.

    Cache identity includes the whole source, input, offsets, model and prompt
    version. A failed chunk never turns into an accepted digest or report.
    """
    model = resolve_default_model()
    source_hash = hashlib.sha256(text.encode()).hexdigest()
    cached = {r.body_json.get("cacheKey"): r for r in session.exec(
        select(AnalysisReport).where(AnalysisReport.doc_id == doc.id, AnalysisReport.report_type == "chapter_digest")
    ) if r.body_json and r.body_json.get("promptVersion") == _DIGEST_VERSION}

    async def digest(content: str, fragments: list[dict[str, Any]], kind: str, identity: str) -> dict[str, Any]:
        _check_cancelled(job)
        input_hash = hashlib.sha256(content.encode()).hexdigest()
        key = hashlib.sha256(json.dumps([source_hash, input_hash, model, _DIGEST_VERSION, kind, identity]).encode()).hexdigest()
        existing = cached.get(key)
        if existing and isinstance(existing.body_json.get("summary"), str) and 20 <= len(existing.body_json["summary"]) <= 3000:
            return {"summary": existing.body_json["summary"], "id": existing.id, "fragments": existing.source_fragments}
        publish_job_event(job.id, {"type": "token", "text": f"全文分段分析：{identity}\n"})
        response = await _kb_chat(session, job, "digest", [
            {"role": "system", "content": "你是分段拆书分析器。仅概括给定原文片段或已标记摘要，不补写未知章节。保留人物、事件因果、冲突、转折、悬念及片段编号。输出 JSON {summary:string}，summary 必须 20–3000 字符；压缩目标约 2000 字。摘要不充当原文引文。"},
            {"role": "user", "content": f"范围/层级：{identity}\n{content}"},
        ], model=model, temperature=0.2, max_tokens=12000, request_timeout_s=120)
        parsed = _strict_json(response.content)
        summary = parsed.get("summary")
        if not isinstance(summary, str):
            raise ValueError("分段分析 JSON 缺少 summary 字符串")
        summary = summary.strip()
        if not 20 <= len(summary) <= 3000:
            raise ValueError("分段分析摘要为空、过短或超出 3000 字符，请重试该任务；已完成分段会复用")
        row = AnalysisReport(doc_id=doc.id, report_type="chapter_digest", title=f"分段摘要 {identity}",
            body_markdown=summary, source_fragments=fragments,
            body_json={"summary": summary, "kind": kind, "cacheKey": key, "sourceSha256": source_hash,
                "inputSha256": input_hash, "promptVersion": _DIGEST_VERSION, "model": model})
        session.add(row)
        session.commit()
        session.refresh(row)
        cached[key] = row
        return {"summary": summary, "id": row.id, "fragments": fragments}

    leaves = []
    for start in range(0, len(text), _FULL_FRAGMENT_CHARS):
        end = min(start + _FULL_FRAGMENT_CHARS, len(text))
        fragment = {"docId": doc.id, "startChar": start, "endChar": end,
            "sourceSha256": source_hash, "excerptSha256": hashlib.sha256(text[start:end].encode()).hexdigest(),
            "offsetUnit": "unicode_codepoint"}
        leaves.append(await digest(text[start:end], [fragment], "source_fragment", f"原文字符[{start},{end})"))
    source_fragments = [{**leaf["fragments"][0], "digestReportId": leaf["id"]} for leaf in leaves]
    nodes = leaves
    level = 0
    def render(node: dict[str, Any]) -> str:
        ranges = node["fragments"]
        return f"[原文字符{ranges[0]['startChar']}-{ranges[-1]['endChar']}; 摘要ID {node['id']}]\n{node['summary']}"
    while len("\n\n".join(render(node) for node in nodes)) > _FINAL_DIGEST_CHARS:
        level += 1
        next_nodes = []
        # Pairwise reduction guarantees progress even at the maximum summary size.
        for offset in range(0, len(nodes), 2):
            group = nodes[offset:offset + 2]
            if len(group) == 1:
                next_nodes.append(group[0])
                continue
            fragments = [f for node in group for f in node["fragments"]]
            next_nodes.append(await digest("\n\n".join(render(node) for node in group), fragments,
                "summary_reduction", f"第{level}层 原文字符[{fragments[0]['startChar']},{fragments[-1]['endChar']})"))
        nodes = next_nodes
    context = "\n\n".join(render(node) for node in nodes)
    coverage = _excerpt_coverage(doc, text, len(text))
    coverage.update({"mode": "hierarchical_digest", "analysisScope": "full", "fragmentCount": len(leaves),
        "digestPromptVersion": _DIGEST_VERSION, "digestModel": model, "directSourceCharsInFinalPrompt": 0})
    return context, coverage, source_fragments, model


async def analyze_document(session: Session, doc: KnowledgeDoc, job: Job) -> None:
    _check_cancelled(job)
    text = _extract_text_from_storage(doc)
    scope = (job.payload or {}).get("analysisScope", (job.payload or {}).get("analysis_scope", "sample"))
    if scope not in {"sample", "full"}:
        raise ValueError("analysisScope 只支持 sample 或 full")
    analysis_model = None
    if scope == "full":
        excerpt, coverage, source_fragments, analysis_model = await _full_analysis_context(session, doc, job, text)
        extraction_coverage = coverage
    else:
        excerpt = text[:12000]
        coverage = _excerpt_coverage(doc, text, 12000)
        coverage.update({"mode": "direct_excerpt", "analysisScope": "sample"})
        source_fragments = [coverage]
        extraction_coverage = _excerpt_coverage(doc, text, 8000)
    report_ids: list[str] = []
    skill_body = _load_agent_skill_body("kb.report_pipeline")
    publish_job_event(
        job.id,
        {
            "type": "token",
            "text": (
                "已加载 Skill kb/report-pipeline\n"
                if skill_body and "kb-report-pipeline" in skill_body
                else "Skill 回退为内置分析指令\n"
            ),
        },
    )

    for report_type, title in REPORT_TYPES:
        _check_cancelled(job)
        publish_job_event(job.id, {"type": "token", "text": f"生成报告：{title}…\n"})
        skill_type = _SKILL_TYPE_ALIASES.get(report_type, report_type)
        if report_type == "redline_report":
            task_spec = (
                "本轮只产出风险红线报告。"
                "输出 JSON：{summary, findings(array of {paragraph,risk,rewrite}), risks(array), "
                "redFlags(array), quotes(array), markdown}。"
                "高风险必须明确标红并给改写方向；禁止只写「注意合规」；禁止编造原文没有的情节。"
            )
        elif report_type == "dissect_params":
            task_spec = (
                "本轮产出拆书参数完整 11 项（九格 2.md）。输出 JSON，字段必须尽量齐全：\n"
                "schemaVersion='nines-2.md/1',\n"
                "basic{synopsis,genre,typeLabel,approxWords},\n"
                "expectations{big,small[]},\n"
                "setting{background,protagonist,supporting[]},\n"
                "storyline{coreContent,note}（note 提醒：核心内容≠核心梗）,\n"
                "conflicts[],\n"
                "emotionCurve[{beatLabel,value(-10~10),note}],\n"
                "relationships[{from,to,bond}],\n"
                "twists[],\n"
                "qiChengZhuanHe{qi,cheng,zhuan,he,chapterRange},\n"
                "sevenSteps{goal,obstacle,action,result,accident,twist,ending,reverseValidate},\n"
                "rhythmStyle{rhythm,style},\n"
                "unitStories[{id,title,scale,chapterRange,purpose,worthDeepDissect,summary}],\n"
                "extractedHooks[{kind,category,size,titleHook,coreHook,emotionChain,abstractions}],\n"
                "proofread{comparedWithSource,rounds,issues[]},\n"
                "favoriteWorthDeep[], summary, findings, quotes, markdown, applyHints。\n"
                "按单元故事拆，不要假装拆完百万字全书；前四步结果通常应体现失败再反转。"
            )
        elif report_type == "seven_steps":
            task_spec = (
                "本轮产出单元故事七步法报告（≠人设七步）。"
                "输出 JSON：{summary, sevenSteps{goal,obstacle,action,result,accident,twist,ending},"
                "nestedExamples(array), reverseValidateQuestions(array), findings, quotes, markdown, applyHints}。"
                "强调：前四步通常失败；可嵌套；拆书时反向提问验证。"
            )
        elif report_type == "core_hook_extract":
            task_spec = (
                "本轮提取核心梗并与情节卡区分。"
                "输出 JSON：{summary, hooks(array of {kind:core_hook|plot_card, category:thrill|emotion|twist,"
                "size:L1|L2|unit, titleHook, coreHook, emotionChain, abstractions, plotCardSteps}),"
                "findings, quotes, markdown, applyHints}。"
                "核心梗只保情绪链条、可跨题材；情节卡写死步骤。"
            )
        elif report_type == "unit_story":
            task_spec = (
                "本轮按大/中/小层级拆单元故事。"
                "输出 JSON：{summary, units(array of {id,title,scale:macro|volume|unit,chapterRange,"
                "purpose,worthDeepDissect,summary}), favoriteWorthDeep, findings, quotes, markdown, applyHints}。"
                "长篇=N 个单元；剧本≈5～8 个；只标记值得深拆的单元。"
            )
        else:
            task_spec = (
                f"本轮只产出报告类型 `{skill_type}`（落库 id=`{report_type}`，标题「{title}」）。"
                "输出 JSON：{summary, findings(array), quotes(array), markdown, applyHints(array)}。"
                "引用必须来自原文摘录，禁止编造书名外事实；禁止大段 verbatim 复述。"
            )
        system = (
            f"{skill_body}\n\n——运行时任务——\n{task_spec}"
            if skill_body
            else (
                f"你是写作知识库分析 Agent（对齐 kb-report-pipeline）。{task_spec}"
            )
        )
        system += "\n只根据本次提供的摘录或分段摘要分析；明确直接阅读与摘要综合的区别，不补写未知细节。"
        system += "\n保持紧凑：每个列表最多3项，每项用短句；markdown不重复JSON字段全文，整体可见输出控制在3500字以内。"
        if scope == "full":
            system += "\n输入是覆盖全文的分段摘要，不是原文。quotes 必须为空；只能标注摘要所附原文范围供回查，禁止编造原文引文。"
        user = f"书名：{doc.title}\ndoc_id：{doc.id}\n实际分析范围：{json.dumps({key: value for key, value in coverage.items() if key != "chapterHeadings"}, ensure_ascii=False)}\n原文摘录：\n{excerpt}"
        try:
            result = await _kb_chat(session, job, report_type,
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.4,
                max_tokens=12000,
                request_timeout_s=120,
                model=analysis_model,
            )
            data = _strict_json(result.content)
            md = data.get("markdown") or result.content
            body_json = {**data, "coverage": coverage, "relatedExtractionCoverage": extraction_coverage}
            if scope == "full":
                body_json["quotes"] = []
            scope_label = "全文分段摘要综合（不是逐字原文直接输入）" if scope == "full" else ("全部可提取原文" if coverage["complete"] else "开头摘录（并非全书分析）")
            md = f"> 分析范围：{scope_label}，字符 [0, {coverage['endChar']}) / {len(text)}；未提供部分不作判断。\n\n{md}"
        except Exception as exc:  # noqa: BLE001
            logger.exception("report failed %s", report_type)
            session.rollback()
            raise

        # upsert by type
        try:
            existing = session.exec(
                select(AnalysisReport).where(
                    AnalysisReport.doc_id == doc.id,
                    AnalysisReport.report_type == report_type,
                )
            ).first()
            if existing:
                existing.body_markdown = md
                existing.body_json = body_json
                existing.title = title
                existing.source_fragments = source_fragments
                session.add(existing)
                session.commit()
                report_ids.append(existing.id)
            else:
                row = AnalysisReport(
                    doc_id=doc.id,
                    report_type=report_type,
                    title=title,
                    body_markdown=md,
                    body_json=body_json,
                    source_fragments=source_fragments,
                )
                session.add(row)
                session.commit()
                session.refresh(row)
                report_ids.append(row.id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("report persist failed %s", report_type)
            session.rollback()
            raise

    # graph extraction（对齐 kb.graph_build Skill）
    _check_cancelled(job)
    try:
        graph_skill = _load_agent_skill_body("kb.graph_build")
        graph_task = (
            "本轮抽取故事知识图谱（人物/事件/情绪点/爽点/钩子/道具），用于增强推理。"
            "输出 JSON：{nodes:[{id,label,type,category}], edges:[{source,target,relationType,relation}]}。"
            "node.type 取值：person(人物)|event(事件/情节)|emotion(情绪点)|cool(爽点)|hook(钩子)|prop(道具/设定)。"
            "edge.relationType 取值：血缘|情感|对立|利益|同盟|见证|驱动|阻碍|引发|兑现|埋|收|所属。"
            "情绪点/爽点/钩子节点要写 label 概括（如「EP3 打脸」「集尾危机」）；"
            "禁止编造原文没有的实体；每条边须可在摘录中找到依据。"
        )
        graph_system = (
            f"{graph_skill}\n\n——运行时任务——\n{graph_task}"
            if graph_skill
            else graph_task
        )
        result = await _kb_chat(session, job, "graph", 
            [
                {"role": "system", "content": graph_system},
                {
                    "role": "user",
                    "content": f"书名：{doc.title}\ndoc_id：{doc.id}\n原文摘录：\n{excerpt[:8000]}",
                },
            ],
            temperature=0.2,
            max_tokens=8000,
            request_timeout_s=120,
        )
        graph = _strict_json(result.content)
        snap = session.exec(select(GraphSnapshot).where(GraphSnapshot.doc_id == doc.id)).first()
        if not snap:
            snap = GraphSnapshot(doc_id=doc.id)
        snap.nodes = list(graph.get("nodes") or [])
        snap.edges = list(graph.get("edges") or [])
        session.add(snap)
        session.commit()
        session.refresh(snap)
        doc.graph_id = snap.id
    except Exception as exc:  # noqa: BLE001
        logger.warning("graph extract failed: %s", exc)

    # trope clips
    _check_cancelled(job)
    try:
        result = await _kb_chat(session, job, "tropes",
            [
                {
                    "role": "system",
                    "content": (
                        "提取 3-8 个可复用桥段 JSON："
                        "{tropes:[{name,summary,tags,emotionPeak,locator}]}。"
                        "locator 用「第N章/第N集」标注桥段出处，找不到就写「原文开头/中段/结尾」。"
                    ),
                },
                {"role": "user", "content": excerpt[:8000]},
            ],
            temperature=0.5,
            max_tokens=8000,
            request_timeout_s=120,
        )
        data = _strict_json(result.content)
        for t in data.get("tropes") or []:
            peak_raw = t.get("emotionPeak", t.get("emotion_peak"))
            peak: float | None
            try:
                peak = float(peak_raw) if peak_raw is not None and peak_raw != "" else None
            except (TypeError, ValueError):
                peak = None
            session.add(
                TropeClip(
                    name=str(t.get("name") or "未命名桥段")[:200],
                    summary=str(t.get("summary") or "")[:4000],
                    source_doc_id=doc.id,
                    tags=[str(x) for x in (t.get("tags") or [])][:20],
                    emotion_peak=peak,
                    source_locator=f"{'全文分段摘要' if scope == 'full' else '原文摘录'}字符 [0,{extraction_coverage['endChar']})；{str(t.get('locator') or '位置未确认')}"[:200],
                    applicable_genres=[str(x) for x in (t.get("genres") or [])][:20],
                )
            )
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("trope extract failed: %s", exc)
        session.rollback()

    _check_cancelled(job)

    # story fingerprint（相似书判断）
    try:
        from knowledge_vector import local_embed

        from app.models import StoryFingerprint

        genre = ""
        gold_finger = ""
        hook_category = ""
        emotion_vals: list[float] = []
        trope_tags: list[str] = []
        unit_purposes: list[str] = []
        parts: list[str] = [doc.title]

        for rid in report_ids:
            rep = session.get(AnalysisReport, rid)
            if not rep or not rep.body_json:
                continue
            bj = rep.body_json
            if rep.report_type == "dissect_params":
                basic = bj.get("basic") or {}
                genre = str(basic.get("genre") or basic.get("typeLabel") or genre)
                parts.append(genre)
                hooks = bj.get("extractedHooks") or []
                for h in hooks[:3]:
                    g = str(h.get("coreHook") or h.get("titleHook") or "")
                    if g:
                        parts.append(g)
                        if not gold_finger:
                            gold_finger = g
                ec = bj.get("emotionCurve") or []
                for p in ec[:20]:
                    v = p.get("value") if isinstance(p, dict) else p
                    if isinstance(v, (int, float)):
                        emotion_vals.append(float(v))
            elif rep.report_type == "core_hook_extract":
                hooks = bj.get("hooks") or []
                for h in hooks[:5]:
                    g = str(h.get("coreHook") or h.get("titleHook") or "")
                    if g:
                        parts.append(g)
                    if not hook_category:
                        hook_category = str(h.get("category") or "")
            elif rep.report_type == "emotion_curve":
                for v in (bj.get("values") or bj.get("emotionCurve") or [])[:30]:
                    if isinstance(v, (int, float)):
                        emotion_vals.append(float(v))
            elif rep.report_type == "unit_story":
                for u in (bj.get("units") or [])[:10]:
                    p = str((u or {}).get("purpose") or "")
                    if p:
                        unit_purposes.append(p)
                        parts.append(p)

        clips = list(session.exec(select(TropeClip).where(TropeClip.source_doc_id == doc.id)).all())
        for c in clips[:10]:
            trope_tags.extend(c.tags or [])
            parts.append(c.name)

        text = " ".join(p for p in parts if p)[:3000] or doc.title
        vec = (local_embed([text], dim=256) or [[0.0]])[0]
        fp = session.exec(
            select(StoryFingerprint).where(StoryFingerprint.doc_id == doc.id)
        ).first()
        if not fp:
            fp = StoryFingerprint(doc_id=doc.id)
        fp.vector = list(vec)
        fp.genre = genre
        fp.gold_finger = gold_finger
        fp.hook_category = hook_category
        fp.emotion_curve = emotion_vals
        fp.trope_tags = trope_tags
        fp.unit_purposes = unit_purposes
        session.add(fp)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("fingerprint failed: %s", exc)
        session.rollback()

    doc.analysis_report_ids = report_ids
    session.add(doc)
    session.commit()


async def hybrid_search(session: Session, query: str, limit: int = 8) -> dict[str, Any]:
    from sqlmodel import select

    ql = query.lower().strip()
    docs = list(session.exec(select(KnowledgeDoc)))
    tropes = list(session.exec(select(TropeClip)))

    def score_doc(d: KnowledgeDoc) -> int:
        blob = f"{d.title} {' '.join(d.tags)} {d.storage_uri or ''}".lower()
        return blob.count(ql) if ql else 1

    docs_sorted = sorted(docs, key=score_doc, reverse=True)
    tropes_sorted = [
        t
        for t in tropes
        if not ql or ql in t.name.lower() or ql in t.summary.lower()
    ]

    vector_hits: list[dict[str, Any]] = []
    try:
        from vector_store import search_chunks

        vector_hits = await search_chunks(query, limit=limit)
    except Exception as exc:  # noqa: BLE001
        logger.info("vector search unavailable: %s", exc)

    answer_parts = []
    if docs_sorted:
        answer_parts.append(f"本地库命中文档：{docs_sorted[0].title}")
    if vector_hits:
        answer_parts.append(f"向量命中 {len(vector_hits)} 条切片")
    if not answer_parts:
        answer_parts.append("未找到相关本地结果")

    return {
        "docs": docs_sorted[:limit],
        "tropes": tropes_sorted[:limit],
        "vectorHits": vector_hits,
        "answer": "；".join(answer_parts),
        "local": True,
    }
