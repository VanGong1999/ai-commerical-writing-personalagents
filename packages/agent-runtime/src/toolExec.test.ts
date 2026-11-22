import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sliceLines, planParallelBatches, prefetchableBatchIndices } from "./toolExec.ts";

describe("sliceLines", () => {
  const content = ["l0", "l1", "l2", "l3", "l4"].join("\n");

  it("分页：offset 0 limit 2 返回前两行 + nextOffset=2", () => {
    const r = sliceLines(content, 0, 2);
    assert.equal(r.text, "l0\nl1");
    assert.equal(r.nextOffset, 2);
    assert.equal(r.truncated, true);
  });

  it("续读：offset 2 limit 2 返回 l2 l3", () => {
    const r = sliceLines(content, 2, 2);
    assert.equal(r.text, "l2\nl3");
    assert.equal(r.nextOffset, 4);
    assert.equal(r.truncated, true);
  });

  it("越界：offset 超过行数返回空 + truncated=false", () => {
    const r = sliceLines(content, 99, 2);
    assert.equal(r.text, "");
    assert.equal(r.nextOffset, null);
    assert.equal(r.truncated, false);
  });

  it("空内容返回空", () => {
    const r = sliceLines("", 0, 2);
    assert.equal(r.text, "");
    assert.equal(r.nextOffset, null);
    assert.equal(r.truncated, false);
  });

  it("limit 覆盖剩余返回 truncated=false", () => {
    const r = sliceLines(content, 3, 10);
    assert.equal(r.text, "l3\nl4");
    assert.equal(r.nextOffset, null);
    assert.equal(r.truncated, false);
  });
});

describe("planParallelBatches", () => {
  const isParallel = (n: string) => ["a", "b"].includes(n);

  it("连续并行 + 串行断批", () => {
    assert.deepEqual(planParallelBatches(["a", "b", "c", "a"], isParallel), [
      [0, 1],
      [2],
      [3],
    ]);
  });

  it("全串行", () => {
    assert.deepEqual(planParallelBatches(["c", "c"], isParallel), [[0], [1]]);
  });

  it("全并行", () => {
    assert.deepEqual(planParallelBatches(["a", "b", "a"], isParallel), [[0, 1, 2]]);
  });

  it("空列表", () => {
    assert.deepEqual(planParallelBatches([], isParallel), []);
  });
});

describe("prefetchableBatchIndices", () => {
  const isRead = (n: string) => ["a", "b"].includes(n);

  it("写后读不预取（遇到写屏障即停）", () => {
    const names = ["a", "b", "c", "a", "b"]; // a,b=读, c=写
    const batches = planParallelBatches(names, isRead);
    assert.deepEqual(prefetchableBatchIndices(batches, names, isRead), [[0, 1]]);
  });

  it("全读全预取", () => {
    const names = ["a", "b", "a"];
    const batches = planParallelBatches(names, isRead);
    assert.deepEqual(prefetchableBatchIndices(batches, names, isRead), [[0, 1, 2]]);
  });

  it("首批即写则不预取", () => {
    const names = ["c", "a", "b"];
    const batches = planParallelBatches(names, isRead);
    assert.deepEqual(prefetchableBatchIndices(batches, names, isRead), []);
  });
});
