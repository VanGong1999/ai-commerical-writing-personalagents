import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";

const KEY = "xmj-studio-onboarded-v1";

const STEPS = [
  ["从交稿主线开始", "打开人物、大纲或正文继续写。交稿包里可以查看当前格式所需的稿件。"],
  ["选填方法", "需要灵感或想精修时再打开练习。练习留空也能继续写正文。"],
  ["查看 AI 候选", "在 AI 协作中提出要求，核对候选文本，再选择修改或采纳。"],
  ["批量生成", "先选范围和确认方式。分步模式会暂停供你检查，自动模式可连续处理本轮产物。"],
] as const;

/** 首次进入创作台的新手引导：一次性展示，可关闭，不再重复。 */
export function StudioOnboarding() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "1";
    } catch {
      return true;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="studio-onboarding"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          role="note"
        >
          <div className="studio-onboarding__head">
            <strong>创作台怎么用（首次提示）</strong>
            <button type="button" className="btn" onClick={dismiss} aria-label="关闭引导">
              <X size={15} />
            </button>
          </div>
          <div className="studio-onboarding__grid">
            {STEPS.map(([label, detail], i) => (
              <motion.div
                key={label}
                className="studio-onboarding__item"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.24 }}
              >
                <b>{i + 1}</b>
                <div>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
              </motion.div>
            ))}
          </div>
          <div className="studio-onboarding__foot">
            <button type="button" className="btn btn-primary" onClick={dismiss}>
              知道了
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
