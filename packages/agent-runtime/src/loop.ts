/**
 * 循环与图形工程：一等 Loop 声明实体 + loop→loop 图边 DAG 校验。
 * 执行仍走 scheduler/queue；这里只承载「命名 + 边 + 终止上限」。
 */

export type LoopTrigger = "cron" | "stage_complete" | "event";

export type Loop = {
  id: string;
  trigger: LoopTrigger;
  steps: string[];
  /** 度量信号 → 影响谁（如 analytics 数据变化影响内容） */
  feedback?: { signal: string; affects: string[] };
  /** 指向其他 loop id 的图边（须构成 DAG） */
  edges: string[];
  /** 硬上限：单次闭环最多迭代次数，防死循环 */
  maxIterations: number;
};

export const LOOPS: Loop[] = [
  {
    id: "propose",
    trigger: "cron",
    steps: ["gap_scan", "gap_scan.prioritize", "approve"],
    edges: [],
    maxIterations: 1,
  },
  {
    id: "consolidate",
    trigger: "cron",
    steps: ["mem.dreams", "approve"],
    edges: [],
    maxIterations: 1,
  },
  {
    id: "measure",
    trigger: "event",
    steps: ["analytics.review", "revise_proposal", "approve"],
    feedback: { signal: "analytics_delta", affects: ["content"] },
    edges: ["propose"],
    maxIterations: 1,
  },
];

export function assertLoopGraphAcyclic(loops: Loop[]): void {
  const ids = new Set(loops.map((l) => l.id));
  for (const l of loops) {
    for (const e of l.edges) {
      if (!ids.has(e)) {
        throw new Error(`loop graph has an unknown edge: ${l.id} -> ${e}`);
      }
    }
  }
  const color = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=访问中 2=已结束
  const visit = (id: string, stack: string[]): void => {
    const c = color.get(id) ?? 0;
    if (c === 1) {
      throw new Error(`loop graph has a cycle: ${[...stack, id].join(" -> ")}`);
    }
    if (c === 2) return;
    color.set(id, 1);
    const loop = loops.find((l) => l.id === id);
    for (const e of loop?.edges ?? []) {
      visit(e, [...stack, id]);
    }
    color.set(id, 2);
  };
  for (const l of loops) {
    visit(l.id, []);
  }
}
