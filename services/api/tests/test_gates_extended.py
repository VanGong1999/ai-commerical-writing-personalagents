"""Extended hard gates for duanju/manju."""

from __future__ import annotations

import unittest

from app.gates import (
    all_passed,
    check_beat_completeness,
    check_episode_standalone,
    check_pay_motive,
    check_redline_hard,
    check_schema_fields,
    check_scene_triple,
    check_shell_gate,
    run_gate_battery,
)


class TestGatesExtended(unittest.TestCase):
    def test_genre_trim_advice(self) -> None:
        for name in ("GenreTrim", "GenreTrimGate"):
            missing = run_gate_battery(name, text="末世")[0]
            self.assertEqual(missing["result"], "warn")
            self.assertIn("未评估", missing["message"])
            review = run_gate_battery(name, body={"genre": " 末世诡异 "}, blacklist=["末世", "诡异"])[0]
            self.assertEqual(review["result"], "warn")
            self.assertIn(" 末世诡异 ", review["message"])
            self.assertIn("末世、诡异", review["message"])

    def test_scene_triple(self) -> None:
        self.assertEqual(check_scene_triple({})["result"], "fail")
        self.assertEqual(
            check_scene_triple({"goal": "要钥匙", "conflict": "反派拦路", "turn": "反杀"})["result"],
            "pass",
        )

    def test_scene_gate_aliases_and_episode_standalone(self) -> None:
        body = {
            "scene_header": "1|酒店宴会厅|内|夜",
            "triple": {"info": "x", "progress": "y", "change": "z"},
            "clip_candidate": "亮婚书",
            "script_body": "环境动作对白" * 30,
        }
        self.assertTrue(all_passed(run_gate_battery("SceneTripleGate", body={"goal": "g", "conflict": "c", "turn": "t"})))
        self.assertTrue(all_passed(run_gate_battery("LocationBudgetGate", unique_count=3, max=12)))
        self.assertTrue(all_passed(run_gate_battery("EpisodeStandaloneGate", body=body)))
        self.assertFalse(all_passed(run_gate_battery("EpisodeStandaloneGate", body={})))
        self.assertEqual(check_episode_standalone(body)["result"], "pass")

    def test_schema_rejects_placeholders(self) -> None:
        self.assertEqual(check_schema_fields({"summary": "真实内容"}, [])["result"], "pass")
        bad = check_schema_fields({"summary": "开头 [短篇小说梗概内容] 结尾"}, [])
        self.assertEqual(bad["result"], "fail")

    def test_new_business_gates_and_alias_fallback(self) -> None:
        from app.gates import (
            check_bio_complete,
            check_empathy,
            check_revise20_pass,
            check_title_clarity,
        )

        self.assertEqual(check_title_clarity("赘婿重生：商界大佬")["result"], "pass")
        self.assertEqual(check_title_clarity("")["result"], "fail")
        self.assertEqual(
            check_bio_complete({"name": "n", "role": "r", "want": "w", "fear": "f", "flaw": "x"})["result"],
            "pass",
        )
        self.assertEqual(check_empathy({"target": "观众", "pains": ["a", "b", "c"]})["result"], "pass")
        self.assertEqual(
            check_revise20_pass([{"pass": True}] * 20, expect=20)["result"], "pass"
        )
        # 别名回退：GenderPathGate → GenderPath 已注册
        self.assertNotEqual(
            run_gate_battery("GenderPathGate", path="male")[0]["result"],
            "inconclusive",
        )

    def test_beat20(self) -> None:
        self.assertEqual(check_beat_completeness([], expect=20)["result"], "fail")
        beats = [{"summary": f"b{i}"} for i in range(20)]
        self.assertEqual(check_beat_completeness(beats)["result"], "pass")

    def test_shell_pay_motive(self) -> None:
        self.assertEqual(check_shell_gate("升级流")["result"], "pass")
        self.assertEqual(
            check_pay_motive({"want": "爽", "how": "打脸", "via_what": "金手指"})["result"],
            "pass",
        )

    def test_redline(self) -> None:
        self.assertEqual(check_redline_hard("普通剧情")["result"], "pass")

    def test_battery_dispatch(self) -> None:
        self.assertTrue(all_passed(run_gate_battery("RedlineHard", text="普通内容")))
        self.assertFalse(all_passed(run_gate_battery("HumanConfirm", acked=False)))
        self.assertTrue(all_passed(run_gate_battery("GenderPath", path="女频")))
        self.assertTrue(
            all_passed(
                run_gate_battery(
                    "SceneTriple",
                    body={"目标": "逃", "冲突": "围堵", "转机": "反杀"},
                )
            )
        )

    def test_comedy_relation(self) -> None:
        self.assertTrue(
            all_passed(
                run_gate_battery(
                    "ComedyDoseGate",
                    body={"dose": "整部", "pay_model": "重付费", "yy_intensity": "强"},
                )
            )
        )
        self.assertTrue(
            all_passed(
                run_gate_battery(
                    "ComedyDose",
                    body={
                        "dose": "元素",
                        "comedy_inserts": [
                            {"offense": "当众破防", "distance": "闹剧窗"}
                        ],
                    },
                )
            )
        )
        self.assertFalse(all_passed(run_gate_battery("RelationDriver", body={})))
        self.assertTrue(
            all_passed(
                run_gate_battery(
                    "RelationDriverGate",
                    body={
                        "a_motive": "夺回股份",
                        "b_motive": "隐瞒身份",
                        "escalation": "婚礼对峙",
                    },
                )
            )
        )


if __name__ == "__main__":
    unittest.main()


def test_optional_measurements_and_graph_integrity():
    cases = [
        ("VoiceDiversity", {"score": 0.60}), ("VoiceDiversity", {}),
        ("OutlineNoEvenActs", {"text": "利润平均分配？"}),
        ("OOC", {"flagged": True}), ("OOC", {"bible": "独居"}),
        ("SimilarityRisk", {"score": 1.0}), ("SimilarityRisk", {}),
        ("ComedyDose", {"body": {"dose": "整部", "yy_intensity": "不强", "comedy_cast_count": 2}}),
        ("GoldFingerMinimal", {"body": {"goldFinger": "边界案例" * 100}}),
        ("SettingCap", {"body": {"settingCount": 3}}), ("SettingCap", {}),
        ("EightTropeCoverage", {"tropes": []}), ("EightTropeCoverage", {}),
    ]
    for gate, payload in cases:
        assert run_gate_battery(gate, **payload)[0]["result"] == "warn", gate
    graph = dict(nodes=[dict(id="lead")], edges=[], characterStates=[
        dict(characterId="lead", episode=3, location=location) for location in ("家", "车站")])
    assert run_gate_battery("GraphConsistency", graph=graph)[0]["result"] == "warn"
    graph["edges"].append(dict(**{"from": "lead", "to": "absent"}))
    assert run_gate_battery("GraphConsistency", graph=graph)[0]["result"] == "fail"


def test_rule_field_count_alone_cannot_measure_length():
    result = run_gate_battery("GoldFingerMinimal", body={"ruleFieldCount": 2})[0]
    assert result["result"] == "warn"
    assert "篇幅未评估" in result["message"]
    assert "字段数 2" in result["message"]
    assert "字数 0" not in result["message"]
