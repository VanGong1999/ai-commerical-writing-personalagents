import { Button } from "@xiezuomanju/ui";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "xiezuomanju.colleague.tour.v1";

const STEPS: Array<{ title: string; body: string; selector: string }> = [
  {
    title: "总编默认联系人",
    body: "总编始终置顶，是群聊编排者与默认对接人。点选即可私聊。",
    selector: "[data-tour='chief']",
  },
  {
    title: "同事分组",
    body: "左侧按职能分组展开，可搜索、按体裁筛选，了解专职同事的职责。",
    selector: "[data-tour='roster-groups']",
  },
  {
    title: "@ 与 / 技能",
    body: "聊天框用 @ 点名同事、用 / 调用技能；开启「追问」可在任务进行中强制继续。",
    selector: "[data-tour='composer']",
  },
  {
    title: "编组",
    body: "多选同事后点「编成小组」，或打开编组向导套用编组预设。",
    selector: "[data-tour='group-wizard']",
  },
];

type TourListener = (step: number | null) => void;
const listeners = new Set<TourListener>();
let externalStep: number | null = null;

function notify() {
  for (const fn of listeners) fn(externalStep);
}

/** 从菜单等处启动导览 */
export function startColleagueTour(fromStep = 0) {
  externalStep = fromStep;
  notify();
}

export function ColleagueTour() {
  const [step, setStep] = useState<number | null>(null);
  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number } | null>(
    null,
  );

  const close = useCallback(() => {
    setStep(null);
    externalStep = null;
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const go = useCallback(
    (next: number | null) => {
      if (next === null) {
        close();
        return;
      }
      setStep(next);
    },
    [close],
  );

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const t = window.setTimeout(() => setStep(0), 600);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }, []);

  useEffect(() => {
    const onExt: TourListener = (s) => {
      if (s !== null) setStep(s);
    };
    listeners.add(onExt);
    return () => {
      listeners.delete(onExt);
    };
  }, []);

  useEffect(() => {
    if (step === null) {
      setSpot(null);
      return;
    }
    const sel = STEPS[step]?.selector;
    if (!sel) return;
    const el = document.querySelector(sel);
    if (!el) {
      setSpot(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setSpot({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  const active = step !== null && step >= 0 && step < STEPS.length;
  const cur = active ? STEPS[step] : null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="colleague-tour__launcher"
        data-tour="tour-launcher"
        onClick={() => startColleagueTour(0)}
      >
        本页导览
      </Button>
      {active && cur ? (
        <div className="colleague-tour" role="dialog" aria-modal="true" aria-label="同事页导览">
          <div className="colleague-tour__backdrop" onClick={() => close()} />
          {spot ? (
            <div
              className="colleague-tour__spotlight"
              style={{
                top: spot.top - 6,
                left: spot.left - 6,
                width: spot.width + 12,
                height: spot.height + 12,
              }}
            />
          ) : null}
          <div className="colleague-tour__card">
            <small className="faint">
              {step + 1} / {STEPS.length}
            </small>
            <strong>{cur.title}</strong>
            <p>{cur.body}</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={() => close()}>
                跳过
              </Button>
              {step > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => go(step - 1)}>
                  上一步
                </Button>
              ) : null}
              {step < STEPS.length - 1 ? (
                <Button size="sm" variant="primary" onClick={() => go(step + 1)}>
                  下一步
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => close()}>
                  完成
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
