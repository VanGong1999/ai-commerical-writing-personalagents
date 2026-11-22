import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Info,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/* —— StatusBadge —— */
export type StatusTone = "idle" | "running" | "ok" | "warn" | "fail" | "pending";

const STATUS_LABEL: Record<StatusTone, string> = {
  idle: "未开始",
  running: "进行中",
  ok: "已完成",
  warn: "需注意",
  fail: "失败",
  pending: "待确认",
};

export function StatusBadge({
  tone = "idle",
  label,
  className,
}: {
  tone?: StatusTone;
  label?: string;
  className?: string;
}) {
  return (
    <span className={clsx("status-badge", `status-badge--${tone}`, className)}>
      <span className="status-badge__dot" />
      {label ?? STATUS_LABEL[tone]}
    </span>
  );
}

/* —— Card —— */
export function Card({
  children,
  className,
  interactive,
  onClick,
  style,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const Comp = onClick || interactive ? "button" : "div";
  return (
    <Comp
      type={Comp === "button" ? "button" : undefined}
      className={clsx("ui-card", interactive && "ui-card--interactive", className)}
      style={style}
      onClick={onClick}
    >
      {children}
    </Comp>
  );
}

/* —— Toolbar（搜索/筛选行） —— */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("toolbar", className)}>{children}</div>;
}

/* —— Skeleton —— */
export function Skeleton({
  width,
  height = 14,
  className,
  style,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={clsx("skeleton", className)}
      style={{ width: width ?? "100%", height, ...style }}
      aria-hidden
    />
  );
}

/* —— Drawer —— */
export function Drawer({
  open,
  onOpenChange,
  title,
  side = "right",
  children,
  width = 360,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  side?: "left" | "right";
  children: ReactNode;
  width?: number | string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className={clsx("drawer", side === "left" ? "drawer--left" : "drawer--right")}
          style={{ width: typeof width === "number" ? `${width}px` : width }}
        >
          {(title || true) && (
            <div className="drawer__head">
              <Dialog.Title className="drawer__title">{title ?? ""}</Dialog.Title>
              <button
                type="button"
                className="btn btn-ghost btn-sm drawer__close"
                aria-label="关闭"
                onClick={() => onOpenChange(false)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="drawer__body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* —— Toast —— */
type ToastTone = "info" | "ok" | "warn" | "fail";
type ToastItem = { id: string; message: string; tone: ToastTone };

type ToastApi = {
  push: (message: string, tone?: ToastTone) => void;
  info: (message: string) => void;
  ok: (message: string) => void;
  warn: (message: string) => void;
  fail: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
let externalPush: ToastApi["push"] | null = null;

export const toast: ToastApi = {
  push: (message, tone = "info") => externalPush?.(message, tone),
  info: (m) => toast.push(m, "info"),
  ok: (m) => toast.push(m, "ok"),
  warn: (m) => toast.push(m, "warn"),
  fail: (m) => toast.push(m, "fail"),
  error: (m) => toast.push(m, "fail"),
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    externalPush = push;
    return () => {
      if (externalPush === push) externalPush = null;
    };
  }, [push]);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      info: (m) => push(m, "info"),
      ok: (m) => push(m, "ok"),
      warn: (m) => push(m, "warn"),
      fail: (m) => push(m, "fail"),
      error: (m) => push(m, "fail"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx("toast", `toast--${t.tone}`)}>
            {t.tone === "ok" && <CheckCircle2 size={15} />}
            {t.tone === "warn" && <AlertCircle size={15} />}
            {t.tone === "fail" && <AlertCircle size={15} />}
            {t.tone === "info" && <Info size={15} />}
            <span>{t.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="关闭"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return toast;
  return ctx;
}

/* —— AgentTimeline —— */
export type AgentTimelineItem = {
  id: string;
  title: string;
  detail?: string;
  tone?: StatusTone;
  time?: string;
};

export function AgentTimeline({ items }: { items: AgentTimelineItem[] }) {
  if (!items.length) {
    return <div className="empty">暂无执行记录</div>;
  }
  return (
    <ol className="agent-timeline">
      {items.map((item) => (
        <li key={item.id} className="agent-timeline__item" data-tone={item.tone ?? "idle"}>
          <span className="agent-timeline__marker" />
          <div className="agent-timeline__content">
            <div className="agent-timeline__title">
              <span>{item.title}</span>
              {item.time && <span className="faint">{item.time}</span>}
            </div>
            {item.detail && <div className="agent-timeline__detail">{item.detail}</div>}
            {item.tone && item.tone !== "idle" && (
              <StatusBadge tone={item.tone} className="agent-timeline__badge" />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* —— Step status icon for binder —— */
export function StepStatusIcon({
  done,
  active,
  size = 14,
}: {
  done?: boolean;
  active?: boolean;
  size?: number;
}) {
  if (done) return <CheckCircle2 size={size} className="step-icon step-icon--ok" />;
  if (active) return <Loader2 size={size} className="step-icon step-icon--running" />;
  return <Circle size={size} className="step-icon step-icon--idle" />;
}

/* —— Icon button helper —— */
export function IconButton({
  icon: Icon,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      className={clsx("btn btn-ghost btn-sm icon-btn", className)}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}

/* —— ViewToggle —— */
export function ViewToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string; icon?: LucideIcon }[];
}) {
  return (
    <div className="view-toggle" role="group">
      {options.map((o) => {
        const I = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            data-active={o.id === value}
            onClick={() => onChange(o.id)}
          >
            {I && <I size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* —— ProgressBar —— */
export function ProgressBar({
  value,
  className,
  style,
}: {
  value: number;
  className?: string;
  style?: CSSProperties;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={clsx("progress", className)}
      role="progressbar"
      aria-valuenow={pct}
      style={style}
    >
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* —— EmptyState enhanced —— */
export function EmptyBlock({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-block">
      {Icon && (
        <div className="empty-block__icon">
          <Icon size={22} />
        </div>
      )}
      <div className="empty-block__title">{title}</div>
      {description && <div className="empty-block__desc">{description}</div>}
      {action && <div className="empty-block__action">{action}</div>}
    </div>
  );
}

/* —— Markdown 轻量渲染（无第三方依赖） —— */
function formatInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={idx++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={idx++}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

export function MarkdownProse({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const flushParagraph = (buf: string[]) => {
    const text = buf.join("\n").trim();
    if (!text) return;
    blocks.push(<p key={`p-${key++}`}>{formatInline(text)}</p>);
  };

  while (i < lines.length) {
    const line = lines[i];
    if (/^###\s+/.test(line)) {
      blocks.push(<h3 key={`h-${key++}`}>{line.replace(/^###\s+/, "")}</h3>);
      i += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      blocks.push(<h2 key={`h-${key++}`}>{line.replace(/^##\s+/, "")}</h2>);
      i += 1;
      continue;
    }
    if (/^#\s+/.test(line)) {
      blocks.push(<h1 key={`h-${key++}`}>{line.replace(/^#\s+/, "")}</h1>);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${key++}`}>
          {items.map((t, idx) => (
            <li key={idx}>{formatInline(t)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${key++}`}>
          {items.map((t, idx) => (
            <li key={idx}>{formatInline(t)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const buf = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    flushParagraph(buf);
  }

  return <div className="report-md">{blocks}</div>;
}
