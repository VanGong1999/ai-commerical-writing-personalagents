import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { GateCheck, GateResult } from "@xiezuomanju/domain";
import clsx from "clsx";
import { Check, ChevronDown, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
  Children,
  useEffect,
  isValidElement,
  useRef,
  useState,
} from "react";

export function Button({
  variant = "default",
  size,
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      className={clsx(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "danger" && "btn-danger",
        variant === "ghost" && "btn-ghost",
        size === "sm" && "btn-sm",
        loading && "btn-loading",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="btn-spinner" aria-hidden />}
      {children}
    </button>
  );
}

type SelectChangeEvent = {
  target: { name?: string; value: string };
  stopPropagation: () => void;
};

type SelectOption = {
  key: string;
  value: string;
  label: ReactNode;
  disabled: boolean;
};

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}

function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement<{
      children?: ReactNode;
      disabled?: boolean;
      value?: string | number;
    }>(child)) {
      return [];
    }
    const label = child.props.children;
    return [
      {
        key: String(child.key ?? index),
        value: String(child.props.value ?? textContent(label)),
        label,
        disabled: Boolean(child.props.disabled),
      },
    ];
  });
}

/**
 * 全站统一选择器。API 兼容原生 select 的受控用法，菜单使用共享设计令牌渲染。
 */
export function Select({
  children,
  value,
  onChange,
  className,
  disabled,
  title,
  onClick,
  id,
  name,
  style,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  children: ReactNode;
  value?: string | number;
  onChange?: (event: SelectChangeEvent) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  id?: string;
  name?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const options = readOptions(children);
  const currentValue = value == null ? options[0]?.value : String(value);
  const selected = options.find((option) => option.value === currentValue);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          className={clsx("select", "select-trigger", className)}
          disabled={disabled}
          title={title}
          onClick={onClick}
          style={style}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
        >
          <span className="select-trigger__value">{selected?.label ?? "请选择"}</span>
          <ChevronDown className="select-trigger__chevron" size={14} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="select-menu"
          align="start"
          sideOffset={6}
          collisionPadding={10}
          style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}
        >
          <DropdownMenu.RadioGroup
            value={currentValue}
            onValueChange={(nextValue) => {
              onChange?.({
                target: { name, value: nextValue },
                stopPropagation: () => {},
              });
            }}
          >
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.key}
                value={option.value}
                disabled={option.disabled}
                className="select-menu__item"
              >
                <span className="select-menu__label">{option.label}</span>
                <DropdownMenu.ItemIndicator className="select-menu__indicator">
                  <Check size={14} strokeWidth={2.4} aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Badge({
  tone = "default",
  children,
  title,
  className,
}: {
  tone?: "default" | "ok" | "warn" | "fail";
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "badge",
        tone === "ok" && "badge-ok",
        tone === "warn" && "badge-warn",
        tone === "fail" && "badge-fail",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  style,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={clsx("panel", className)} style={style}>
      {(title || actions) && (
        <div className="panel__head">
          <div>{title}</div>
          <div className="row">{actions}</div>
        </div>
      )}
      <div className="panel__body">{children}</div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  danger,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay">
          <Dialog.Content className="dialog">
            <div className="dialog__head">
              <Dialog.Title>{title}</Dialog.Title>
            </div>
            <div className="dialog__body">
              <Dialog.Description asChild>
                <div>{description}</div>
              </Dialog.Description>
            </div>
            <div className="dialog__foot">
              <Button onClick={() => onOpenChange(false)}>取消</Button>
              <Button
                variant={danger ? "danger" : "primary"}
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 通用弹窗：固定高度、内部滚动，适合详情/说明书/长内容。 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  bodyClassName,
  width,
  height,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay">
          <Dialog.Content
            className={clsx("dialog", className)}
            style={{
              width: typeof width === "number" ? `${width}px` : width,
              height: typeof height === "number" ? `${height}px` : height,
            }}
          >
            <div className="dialog__head">
              <div style={{ minWidth: 0 }}>
                {title ? <Dialog.Title>{title}</Dialog.Title> : null}
                {description ? (
                  <Dialog.Description className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {description}
                  </Dialog.Description>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="关闭"
                onClick={() => onOpenChange(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className={clsx("dialog__body", bodyClassName)}>{children}</div>
            {footer ? <div className="dialog__foot">{footer}</div> : null}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function StageRail({
  stages,
  current,
  done,
  labels,
  onSelect,
}: {
  stages: readonly string[];
  current: string;
  done: Set<string> | string[];
  labels: Record<string, string>;
  onSelect: (stage: string, locked: boolean) => void;
}) {
  const doneSet = done instanceof Set ? done : new Set(done);
  const currentIdx = stages.indexOf(current);

  return (
    <div className="stack" style={{ padding: 8 }}>
      <div className="faint" style={{ fontSize: "var(--fs-xs)", padding: "0 8px" }}>
        创作流程
      </div>
      {stages.map((stage, idx) => {
        const isDone = doneSet.has(stage);
        const locked = idx > currentIdx + 1 && !isDone;
        return (
          <button
            key={stage}
            type="button"
            className="stage-item"
            data-active={stage === current}
            data-done={isDone}
            data-locked={locked}
            title={locked ? "先完成前面的步骤，才能进入这一步" : labels[stage] ?? stage}
            onClick={() => onSelect(stage, locked)}
          >
            <span className="stage-dot" />
            <span>
              <div>{labels[stage] ?? stage}</div>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ArtifactTree({
  items,
  activeId,
  onSelect,
}: {
  items: { id: string; title: string; type: string; status?: string }[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="stack" style={{ padding: 8 }}>
      <div className="faint" style={{ fontSize: "var(--fs-xs)", padding: "0 8px" }}>
        产物
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="tree-item"
          data-active={item.id === activeId}
          onClick={() => onSelect(item.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSelect(item.id);
          }}
          role="button"
          tabIndex={0}
        >
          <Badge>{item.type}</Badge>
          <span style={{ flex: 1 }}>{item.title}</span>
          {item.status && <span className="faint">{item.status}</span>}
        </div>
      ))}
    </div>
  );
}

export function GateBadgeList({ checks }: { checks: GateCheck[] }) {
  const tone = (r: GateResult) =>
    r === "pass" ? "ok" : r === "warn" || r === "inconclusive" ? "warn" : "fail";
  const label = (r: GateResult) =>
    r === "pass" ? "通过" : r === "warn" || r === "inconclusive" ? "需注意" : "未通过";
  return (
    <div className="row">
      {checks.map((c) => (
        <Badge key={c.id} tone={tone(c.result)}>
          {c.name} · {label(c.result)}
        </Badge>
      ))}
    </div>
  );
}

export function TokenChip({
  estimate,
  used,
}: {
  estimate?: number;
  used?: number;
}) {
  return (
    <span className="badge" title="AI 用量单位，约等于字词的计算量">
      AI 用量 {used ?? 0}
      {estimate != null ? ` · 预计 ${estimate}` : ""}
    </span>
  );
}

export function CandidateTable<T extends { id: string }>({
  rows,
  columns,
  selectedIds,
  onToggle,
  onAdopt,
  flashId,
}: {
  rows: T[];
  columns: {
    key: string;
    header: string;
    width?: string | number;
    render: (row: T) => ReactNode;
  }[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onAdopt?: (id: string) => void;
  flashId?: string | null;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 36 }} />
          {columns.map((c) => (
            <th key={c.key} style={{ width: c.width }}>
              {c.header}
            </th>
          ))}
          {onAdopt && <th style={{ width: 88 }}>操作</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            data-selected={selectedIds.has(row.id)}
            className={flashId === row.id ? "adopt-flash" : undefined}
          >
            <td>
              <input
                type="checkbox"
                checked={selectedIds.has(row.id)}
                onChange={() => onToggle(row.id)}
              />
            </td>
            {columns.map((c) => (
              <td key={c.key}>{c.render(row)}</td>
            ))}
            {onAdopt && (
              <td>
                <Button variant="primary" onClick={() => onAdopt(row.id)}>
                  采纳
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StreamPanel({
  text,
  streaming,
  onAbort,
  onStart,
}: {
  text: string;
  streaming: boolean;
  onAbort?: () => void;
  onStart?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);

  return (
    <Panel
      title="流式输出"
      actions={
        <>
          {onStart && (
            <Button variant="primary" disabled={streaming} onClick={onStart}>
              生成
            </Button>
          )}
          {onAbort && (
            <Button disabled={!streaming} onClick={onAbort}>
              中止
            </Button>
          )}
        </>
      }
    >
      <div className="stream" ref={ref}>
        {text || <span className="faint">等待生成…</span>}
        {streaming && <span className="stream__cursor" />}
      </div>
    </Panel>
  );
}

export function DiffCompare({
  leftTitle,
  rightTitle,
  left,
  right,
}: {
  leftTitle: string;
  rightTitle: string;
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="split">
      <Panel title={leftTitle}>{left}</Panel>
      <Panel title={rightTitle}>{right}</Panel>
    </div>
  );
}

export function PromptDrawer({
  open,
  lockedSystem,
  editableInstruction,
  onEditableChange,
  gates,
  onClose,
  onRun,
}: {
  open: boolean;
  lockedSystem: string;
  editableInstruction: string;
  onEditableChange: (v: string) => void;
  gates: GateCheck[];
  onClose: () => void;
  onRun: () => void;
}) {
  if (!open) return null;
  const blocked = gates.some((g) => g.result === "fail");
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: "min(720px, calc(100vw - 32px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">Prompt 抽屉</div>
        <div className="dialog__body stack">
          <GateBadgeList checks={gates} />
          <label className="stack">
            <span className="muted">锁定区（只读）</span>
            <textarea className="textarea" value={lockedSystem} readOnly rows={6} />
          </label>
          <label className="stack">
            <span className="muted">可变指令</span>
            <textarea
              className="textarea"
              value={editableInstruction}
              onChange={(e) => onEditableChange(e.target.value)}
              rows={8}
            />
          </label>
        </div>
        <div className="dialog__foot">
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" disabled={blocked} onClick={onRun}>
            校验通过后开跑
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          data-active={t.id === value}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header__text">
        {breadcrumb && <div className="page-header__crumb">{breadcrumb}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

export function useSimulatedStream(fullText: string, chunkMs = 18) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(false);

  const start = () => {
    abortRef.current = false;
    setText("");
    setStreaming(true);
    let i = 0;
    const tick = () => {
      if (abortRef.current) {
        setStreaming(false);
        return;
      }
      i = Math.min(fullText.length, i + 3);
      setText(fullText.slice(0, i));
      if (i < fullText.length) {
        window.setTimeout(tick, chunkMs);
      } else {
        setStreaming(false);
      }
    };
    tick();
  };

  const abort = () => {
    abortRef.current = true;
    setStreaming(false);
  };

  return { text, streaming, start, abort, setText };
}

export function Section({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("page", className)} {...props}>
      {children}
    </div>
  );
}

/** 在应用根包一层；子组件只用 HelpTip。 */
export function HelpProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={180}>{children}</Tooltip.Provider>;
}

/** 鼠标悬停说明：给作家看的白话提示，不是开发文档。 */
export function HelpTip({
  label,
  children,
  side = "top",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={clsx("help-tip", className)} side={side} sideOffset={6}>
          {label}
          <Tooltip.Arrow className="help-tip__arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** 内联「?」帮助按钮。 */
export function HelpIcon({ text, label = "说明" }: { text: string; label?: string }) {
  return (
    <HelpTip label={text}>
      <span className="help-icon" role="button" tabIndex={0} aria-label={label}>
        ?
      </span>
    </HelpTip>
  );
}

/** 操作引导条：告诉用户接下来怎么点。 */
export function HelpCallout({
  title,
  children,
  tone = "info",
  collapsible = false,
  defaultOpen = true,
}: {
  title?: string;
  children: ReactNode;
  tone?: "info" | "tip" | "warn";
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (collapsible) {
    const id = `help-callout-${title ?? tone}`.replace(/\s+/g, "-");
    return (
      <div
        className={clsx("help-callout", `help-callout--${tone}`, "help-callout--collapsible")}
        data-open={open ? "true" : "false"}
      >
        <button
          type="button"
          className="help-callout__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={14} />
          <span>{title ?? "说明"}</span>
        </button>
        <div
          id={id}
          className="help-callout__content"
          aria-hidden={!open}
          inert={open ? undefined : true}
        >
          <div className="help-callout__content-inner">
            <div className="help-callout__body help-callout__body--inner">{children}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={clsx("help-callout", `help-callout--${tone}`)}>
      {title && <div className="help-callout__title">{title}</div>}
      <div className="help-callout__body">{children}</div>
    </div>
  );
}
