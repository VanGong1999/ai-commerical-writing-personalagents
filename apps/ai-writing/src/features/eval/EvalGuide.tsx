import { Button, Panel } from "@xiezuomanju/ui";

const TERMS = [
  { t: "Task / 评测用例", d: "固定输入 + 期望行为 + 评分细则。例如「写一集退婚打脸正文」。" },
  { t: "Rubric / 评分细则", d: "二元问句（是/否/未知）。例：「集尾是否有钩子？」" },
  { t: "黄金集", d: "好稿下限样例——「要做到这个水平」。" },
  { t: "错题集", d: "曾经踩过的坑——「不应再犯第二次」。" },
  { t: "回归集", d: "已知能力必过集，通过率应接近 100%。" },
  { t: "pass@k / pass^k", d: "跑 k 次：至少一个成功 vs 全部成功。写作交付更关心 pass^k。" },
  { t: "两条 Loop", d: "Agent 迭代（改 Prompt/Skill）与评测迭代（补样本/改 Rubric）在 Case 池咬合。" },
];

export function EvalGuide({ onGo }: { onGo: (tab: string) => void }) {
  return (
    <div className="stack-lg">
      <Panel title="第一次跑评测（三步）">
        <ol className="stack-sm" style={{ paddingLeft: 18 }}>
          <li>
            打开「总览」点 <strong>同步种子数据</strong>，写入三门课提炼的评分细则与黄金/错题样例。
          </li>
          <li>
            去「评测运行」选一套 <strong>回归集</strong>（如漫剧正文回归），点运行（可先关 LLM 只跑规则闸）。
          </li>
          <li>
            看 Case×Rubric 热力矩阵与门禁结论；失败项可追溯到课程出处，再回创作台改稿。
          </li>
        </ol>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Button onClick={() => onGo("overview")}>去总览</Button>
          <Button variant="ghost" onClick={() => onGo("runs")}>
            去评测运行
          </Button>
          <Button variant="ghost" onClick={() => onGo("rubrics")}>
            看评分细则
          </Button>
        </div>
      </Panel>

      <Panel title="体系长什么样">
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 12,
            lineHeight: 1.5,
            margin: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >{`离线评测（守已知）──► 三类评分器（代码闸 / LLM 评委 / 人工）
在线抽检+巡检（发现未知）──► Case 池 ──► 归因
                              ├─ Agent 问题 → 改指令/Skill → 再回归
                              └─ 评测问题 → 补样本 / 改 Rubric`}</pre>
      </Panel>

      <Panel title="术语表">
        <div className="stack-sm">
          {TERMS.map((x) => (
            <div key={x.t}>
              <strong>{x.t}</strong>
              <div className="faint" style={{ fontSize: 13 }}>
                {x.d}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="和本项目已有能力的关系">
        <ul style={{ paddingLeft: 18 }} className="stack-sm">
          <li>
            <strong>不重复造轮子</strong>：代码评分直接复用 Gates、去 AI 检测、字数衰减等硬闸。
          </li>
          <li>
            创作台里的去 AI 工作台、RL 分数面板继续用；评测中心负责「可回归的量具」。
          </li>
          <li>
            自动驾驶可开「低分自动返修 1 轮」；写作指令保存前可跑回归门禁。
          </li>
        </ul>
      </Panel>
    </div>
  );
}
