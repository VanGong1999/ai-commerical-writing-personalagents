import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type CollapsibleSectionProps = {
  title: ReactNode;
  summary?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
  bare?: boolean;
};

function readStoredOpen(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`xmj-collapse:${storageKey}`);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

/** 可持久化的折叠区：标题、摘要、状态徽标在收起时仍可见。 */
export function CollapsibleSection({
  title,
  summary,
  badge,
  actions,
  children,
  defaultOpen = true,
  storageKey,
  className,
  bodyClassName,
  style,
  bare = false,
}: CollapsibleSectionProps) {
  const contentId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen));
  const skipNextPersist = useRef(true);

  useEffect(() => {
    setOpen(readStoredOpen(storageKey, defaultOpen));
    skipNextPersist.current = true;
  }, [storageKey, defaultOpen]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    // 切换 storageKey 时先完成读取，避免把上一个折叠区的状态写到新 key。
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    try {
      window.localStorage.setItem(`xmj-collapse:${storageKey}`, open ? "1" : "0");
    } catch {
      /* storage can be unavailable in private contexts */
    }
  }, [open, storageKey]);

  return (
    <section
      className={clsx("collapsible", bare && "collapsible--bare", className)}
      style={style}
      data-open={open}
      aria-labelledby={titleId}
    >
      <div className="collapsible__head">
        <button
          type="button"
          className="collapsible__toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setOpen((value) => !value);
          }}
        >
          <ChevronDown size={14} className="collapsible__chevron" aria-hidden />
          <span id={titleId} className="collapsible__title">
            {title}
          </span>
          {badge ? <span className="collapsible__badge">{badge}</span> : null}
          {!open && summary ? (
            <span className="collapsible__summary">{summary}</span>
          ) : null}
        </button>
        {actions ? (
          <div className="collapsible__actions">{actions}</div>
        ) : null}
      </div>
      <div
        id={contentId}
        className="collapsible__content"
        data-open={open}
        aria-hidden={!open}
        inert={open ? undefined : true}
      >
        <div className="collapsible__content-inner">
          <div className={clsx("collapsible__body", bodyClassName)}>{children}</div>
        </div>
      </div>
    </section>
  );
}
