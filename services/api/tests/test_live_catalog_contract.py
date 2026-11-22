import asyncio
from types import SimpleNamespace

from app.routers.personal_agent import _execute_supervisor_tool


def call(name, **args):
    return asyncio.run(_execute_supervisor_tool(name, args, None, SimpleNamespace(project_id=None)))[1]


def test_stage_graph_label_and_unknown():
    assert call("get_stage_graph", format="漫剧")["stages"] == call("get_stage_graph", format="manju")["stages"] != []
    assert call("get_stage_graph", format="unknown")["error"] == "unknown_format"


def test_dialogue_search():
    for query in ("对白审校", "prose.dialogue_voice", "prose 对白"):
        assert call("search_agents", query=query)["agents"][0]["id"] == "prose.dialogue_voice"


def test_course_shell_does_not_change_legacy_shell():
    from app.gates import run_gate_battery
    body = dict(story_shell="谜题", shell_reason="揭开谜面", pay_model="轻付费", midpoint_type="找答案→解谜面")
    assert run_gate_battery("ShellGate", body=body)[0]["result"] == "pass"
    assert run_gate_battery("ShellGate", body={**body, "pay_model": "重付费"})[0]["result"] == "warn"
    assert run_gate_battery("Shell", shell="复仇壳")[0]["result"] == "pass"
