from app.routers.agents_catalog import StageLockIn, stage_lock_action


def test_inspection_preserves_unconfirmed_stage():
    request = StageLockIn(format="manju", currentStageId="S2_LOGLINE_100", completed=[], action="inspect")
    state = stage_lock_action(request)["state"]
    assert state["currentStageId"] == "S2_LOGLINE_100"
    assert state["completed"] == []
