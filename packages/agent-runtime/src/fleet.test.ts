import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertFleetSize,
  emptyFleetResult,
  fleetAllTerminal,
  fleetWorkdirKey,
  mergeFleetReports,
  planFleetJobs,
  MAX_FLEET_MEMBERS,
} from "./fleet.ts";

describe("fleet", () => {
  it("plans one job envelope per member", () => {
    const plan = {
      id: "fleet1",
      mode: "ordered" as const,
      mergePolicy: "human" as const,
      projectId: "p1",
      members: [
        { name: "a", workdir: "", task: "scout" },
        { name: "b", workdir: "", task: "review" },
      ],
    };
    const jobs = planFleetJobs(plan);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].payload.fleetId, "fleet1");
    assert.equal(jobs[0].payload.fleetIndex, 0);
    assert.match(String(jobs[0].payload.workdir), /fleet\/fleet1\/a/);
  });

  it("rejects oversize fleets", () => {
    const members = Array.from({ length: MAX_FLEET_MEMBERS + 1 }, (_, i) => ({
      name: `m${i}`,
      workdir: "",
      task: "t",
    }));
    assert.throws(() => assertFleetSize(members));
  });

  it("merges ordered / union / synthesis shapes", () => {
    const reports = [
      { name: "a", status: "done" as const, summary: "A ok", index: 0 },
      { name: "b", status: "done" as const, summary: "B ok", index: 1 },
    ];
    const ordered = mergeFleetReports("ordered", reports);
    assert.match(ordered.markdown, /Fleet Ordered/);
    assert.match(ordered.markdown, /\[0\] a/);

    const union = mergeFleetReports("union", reports);
    assert.match(union.markdown, /Fleet Union/);
    assert.ok(union.memberSummaries.includes("A ok"));

    const syn = mergeFleetReports("synthesis", reports);
    assert.ok(syn.synthesisInput);
    assert.equal(syn.synthesisInput?.task.includes("综合"), true);
  });

  it("workdir key and terminal check", () => {
    assert.equal(
      fleetWorkdirKey("p1", "f1", "Scout!"),
      "/memories/projects/p1/fleet/f1/Scout_",
    );
    const r = emptyFleetResult({
      id: "f1",
      mode: "union",
      mergePolicy: "refuse",
      members: [{ name: "x", workdir: "", task: "t" }],
    });
    assert.equal(fleetAllTerminal(r.reports), false);
    r.reports[0].status = "done";
    assert.equal(fleetAllTerminal(r.reports), true);
  });
});
