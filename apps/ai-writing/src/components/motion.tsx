import { motion, type Variants } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

/** 淡入上移。 */
export function FadeIn({
  children,
  delay = 0,
  y = 10,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/** 列表交错入场。 */
const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: "easeOut" } },
};

export function Stagger({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}

/** 悬停轻微放大。 */
export function HoverScale({
  children,
  scale = 1.02,
  className,
}: {
  children: ReactNode;
  scale?: number;
  className?: string;
}) {
  return (
    <motion.div className={className} whileHover={{ scale }} transition={{ duration: 0.16 }}>
      {children}
    </motion.div>
  );
}

/** 空态 + 引导动画（脉冲示意下一步）。 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {icon && (
        <motion.div
          className="empty__icon"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          {icon}
        </motion.div>
      )}
      <div className="empty__title">{title}</div>
      {description && <div className="faint" style={{ fontSize: 13 }}>{description}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </motion.div>
  );
}

/** 节点状态脉冲（进行中 = 呼吸，已完成 = 常亮）。 */
export function PulseDot({
  active,
  tone = "accent",
  size = 10,
}: {
  active?: boolean;
  tone?: "accent" | "ok" | "warn";
  size?: number;
}) {
  const color =
    tone === "ok" ? "var(--ok, #22c55e)" : tone === "warn" ? "var(--warn, #f59e0b)" : "var(--accent, #6366f1)";
  return (
    <motion.span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
      }}
      animate={active ? { scale: [1, 1.5, 1], opacity: [1, 0.6, 1] } : { scale: 1, opacity: 1 }}
      transition={active ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
    />
  );
}
