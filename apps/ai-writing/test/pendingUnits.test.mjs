import test from "node:test";
import assert from "node:assert/strict";
import { pendingUnits } from "../src/features/studio/pendingUnits.ts";
test("plans first five missing outlines and protects existing scene drafts", () => {
  assert.deepEqual(pendingUnits([], [{bodyJson:{scene_header:"2-1"}}], "5", 10), [1,3,4,5]);
});
test("all outlines deduplicates unit numbers and stops when complete", () => {
  const outlines = [1,1,2].map(episodeNo => ({bodyJson:{episodeNo}}));
  assert.deepEqual(pendingUnits(outlines, [], "all", 10), [1,2]);
  assert.deepEqual(pendingUnits(outlines, outlines, "all", 10), []);
});
test("numeric targets and existing outline numbers are independent of package minima", () => {
  assert.deepEqual(pendingUnits([], [], "5", 1), [1,2,3,4,5]);
  assert.deepEqual(pendingUnits([{bodyJson:{episodeNo:11}}], [], "all", 3), [11]);
  assert.deepEqual(pendingUnits([], [], "all", 3), [1,2,3]);
});
import { buildBatchPlan } from "../src/features/studio/pendingUnits.ts";
import { autopilotPipelineFor } from "../src/features/studio/autopilotPipeline.ts";
test("real episode pipelines schedule the requested range and skip all existing drafts", () => {
  for (const format of ["ip_adapt", "duanju", "manju"]) {
    const options = {
      chain: autopilotPipelineFor(format), hasHook:true, hasCharacters:true,
      episodeBased:true, outlineReadyCount:0, outlineTarget:format === "ip_adapt" ? 1 : 10,
      bodyReadyCount:0, bodyTarget:format === "manju" ? 3 : 1,
      bodyLimit:"5", outlineArts:[], manuscripts:[{bodyJson:{scene_header:"2-03"}}], enabled:()=>true,
    };
    const units = buildBatchPlan(options).filter(item => item.step.id === "body").map(item=>item.episodeNo);
    assert.deepEqual(units,[1,3,4,5]);
    const written = [2,2,12].map(episodeNo=>({bodyJson:{episodeNo}}));
    assert.deepEqual(buildBatchPlan({...options,bodyLimit:"all",outlineArts:written,manuscripts:written}).filter(item=>item.step.id==="body"),[]);
  }
});
