import { Badge } from "@xiezuomanju/ui";
import { formatLabel } from "../../api/client";
import type { RosterColleague } from "../../api/client";
import type { ProjectFormat } from "@xiezuomanju/domain";

export function ColleagueCard({ colleague }: { colleague: RosterColleague }) {
  const formats = colleague.formatLabels?.length
    ? colleague.formatLabels
  : (colleague.formats || []).map((f) =>
      f === "*" ? "全体裁" : formatLabel(f as ProjectFormat),
    );

  return (
    <div className="colleague-card">
      <header className="colleague-card__head">
        <span className="colleague-card__emoji">{colleague.emoji}</span>
        <div>
          <strong>{colleague.displayName || colleague.name}</strong>
          <small style={{ color: colleague.teamColor }}>{colleague.team}</small>
        </div>
      </header>
      {colleague.summary ? <p className="colleague-card__summary">{colleague.summary}</p> : null}
      {colleague.when ? (
        <div className="colleague-card__row">
          <span className="colleague-card__label">何时出场</span>
          <span>{colleague.when}</span>
        </div>
      ) : null}
      {formats.length ? (
        <div className="colleague-card__row">
          <span className="colleague-card__label">体裁</span>
          <span className="colleague-card__tags">
            {formats.map((f) => (
              <Badge key={f} tone="default">
                {f}
              </Badge>
            ))}
          </span>
        </div>
      ) : null}
      {colleague.stage ? (
        <div className="colleague-card__row">
          <span className="colleague-card__label">阶段</span>
          <span>{colleague.stage}</span>
        </div>
      ) : null}
      {colleague.upstream?.length ? (
        <div className="colleague-card__row">
          <span className="colleague-card__label">上游</span>
          <span>{colleague.upstream.map((u) => u.name).join("、")}</span>
        </div>
      ) : null}
      {colleague.downstream?.length ? (
        <div className="colleague-card__row">
          <span className="colleague-card__label">下游</span>
          <span>{colleague.downstream.map((u) => u.name).join("、")}</span>
        </div>
      ) : null}
      {colleague.tools?.length ? (
        <div className="colleague-card__row colleague-card__row--stack">
          <span className="colleague-card__label">工具</span>
          <ul className="colleague-card__tools">
            {colleague.tools.map((t) => (
              <li key={t.id}>
                <strong>{t.label}</strong>
                {t.desc ? <span className="faint"> — {t.desc}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {colleague.examplePrompts?.length ? (
        <div className="colleague-card__row colleague-card__row--stack">
          <span className="colleague-card__label">示例指令</span>
          <ul className="colleague-card__prompts">
            {colleague.examplePrompts.map((p, i) => (
              <li key={i}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}