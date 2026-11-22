import { useMutation } from "@tanstack/react-query";
import { Badge, Button, Panel } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";

export function EvalPairwisePanel() {
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const mut = useMutation({
    mutationFn: () => api.evalPairwise({ textA, textB }),
  });

  const result = mut.data as
    | {
        winner?: string;
        votes?: Record<string, number>;
        ab?: { reason?: string };
        ba?: { reason?: string };
        criteria?: string[];
      }
    | undefined;

  return (
    <div className="stack-lg">
      <Panel title="A/B 成对对比（双向评判，控制位置偏差）">
        <div className="grid-2">
          <div>
            <div className="faint">版本 A</div>
            <textarea
              value={textA}
              onChange={(e) => setTextA(e.target.value)}
              rows={12}
              style={{ width: "100%" }}
              placeholder="粘贴正文 A…"
            />
          </div>
          <div>
            <div className="faint">版本 B</div>
            <textarea
              value={textB}
              onChange={(e) => setTextB(e.target.value)}
              rows={12}
              style={{ width: "100%" }}
              placeholder="粘贴正文 B…"
            />
          </div>
        </div>
        <Button
          style={{ marginTop: 12 }}
          onClick={() => mut.mutate()}
          disabled={!textA.trim() || !textB.trim() || mut.isPending}
        >
          {mut.isPending ? "评判中…" : "开始双向对比"}
        </Button>
      </Panel>
      {result && (
        <Panel title="结果">
          <div className="row" style={{ gap: 8 }}>
            <Badge tone={result.winner === "tie" ? "warn" : "ok"}>胜者 {result.winner}</Badge>
            <span className="faint">
              票数 A={result.votes?.A ?? 0} B={result.votes?.B ?? 0} tie={result.votes?.tie ?? 0}
            </span>
          </div>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <div className="faint">A→B 理由</div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{result.ab?.reason || "—"}</pre>
            </div>
            <div>
              <div className="faint">B→A 映射后理由</div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{result.ba?.reason || "—"}</pre>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
