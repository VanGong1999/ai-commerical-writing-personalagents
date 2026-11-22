import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** 全局图表配色，暗色主题下仍可读。 */
export const CHART_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
] as const;

const AXIS_TICK = { fill: "var(--faint, #94a3b8)", fontSize: 11 };
const GRID_STROKE = "var(--border, #334155)";

export type TrendPoint = { day: string; value: number };
export type FormatPoint = { format: string; label: string; value: number };
export type StatusPoint = { status: string; label: string; value: number };
export type EmotionPoint = {
  x: string;
  value: number;
  mark?: "paywall" | "card" | "peak" | "cool";
};

/** 面积 / 折线趋势图（近 N 天用量 / 字数等）。 */
export function TrendArea({
  data,
  dataKey = "value",
  xKey = "day",
  color = CHART_COLORS[0],
  height = 180,
}: {
  data: TrendPoint[];
  dataKey?: string;
  xKey?: string;
  color?: string;
  height?: number;
}) {
  if (!data.length) return <div className="empty">暂无趋势数据</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={{ background: "var(--bg-elevated, #1e293b)", border: "1px solid var(--border, #334155)", borderRadius: 8, fontSize: 12 }}
        />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** 按格式汇总的柱状图。 */
export function FormatBar({
  data,
  dataKey = "value",
  nameKey = "label",
  color = CHART_COLORS[0],
  height = 200,
}: {
  data: FormatPoint[];
  dataKey?: string;
  nameKey?: string;
  color?: string;
  height?: number;
}) {
  if (!data.length) return <div className="empty">暂无格式数据</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={nameKey} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          cursor={{ fill: "var(--bg-elevated, #1e293b)" }}
          contentStyle={{ background: "var(--bg-elevated, #1e293b)", border: "1px solid var(--border, #334155)", borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 状态分布环形图。 */
export function StatusDonut({
  data,
  nameKey = "label",
  dataKey = "value",
  height = 200,
}: {
  data: StatusPoint[];
  nameKey?: string;
  dataKey?: string;
  height?: number;
}) {
  if (!data.length) return <div className="empty">暂无状态数据</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius="55%" outerRadius="80%" paddingAngle={2} strokeWidth={0}>
          {data.map((d, i) => (
            <Cell key={d.status} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "var(--bg-elevated, #1e293b)", border: "1px solid var(--border, #334155)", borderRadius: 8, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** 情绪曲线，叠加付费点 / 卡点 / 情绪峰 / 爽点标记（全格式通用）。 */
export function EmotionCurve({
  data,
  height = 200,
  domain = [0, 10],
}: {
  data: EmotionPoint[];
  height?: number;
  domain?: [number, number];
}) {
  if (!data.length) return <div className="empty">暂无情绪曲线</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis domain={domain} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={{ background: "var(--bg-elevated, #1e293b)", border: "1px solid var(--border, #334155)", borderRadius: 8, fontSize: 12 }}
        />
        <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
        {data
          .filter((d) => d.mark)
          .map((d, i) => {
            const mark = d.mark!;
            const color =
              mark === "paywall"
                ? CHART_COLORS[3]
                : mark === "card"
                  ? CHART_COLORS[4]
                  : mark === "peak"
                    ? CHART_COLORS[2]
                    : CHART_COLORS[1];
            return (
              <Line
                key={`${mark}-${i}`}
                data={[d]}
                dataKey="value"
                stroke={color}
                strokeWidth={0}
                dot={{ r: 5, fill: color, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            );
          })}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 故事指纹雷达图。 */
export function RadarFingerprint({
  data,
  height = 220,
}: {
  data: { axis: string; value: number }[];
  height?: number;
}) {
  if (!data.length) return <div className="empty">暂无指纹数据</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="70%">
        <PolarGrid stroke={GRID_STROKE} />
        <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--faint, #94a3b8)", fontSize: 11 }} />
        <PolarRadiusAxis angle={90} domain={[0, 10]} tick={false} axisLine={false} />
        <Radar dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.3} />
        <Tooltip
          contentStyle={{ background: "var(--bg-elevated, #1e293b)", border: "1px solid var(--border, #334155)", borderRadius: 8, fontSize: 12 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/** 预算环形进度（用量 / 预算）。 */
export function BudgetRing({
  used,
  budget,
  height = 180,
}: {
  used: number;
  budget: number;
  height?: number;
}) {
  const pct = budget > 0 ? Math.min(1, used / budget) : 0;
  const color = pct >= 1 ? CHART_COLORS[3] : pct >= 0.9 ? CHART_COLORS[2] : CHART_COLORS[1];
  const data = [{ name: "budget", value: Math.round(pct * 100), fill: color }];
  return (
    <div className="stack" style={{ alignItems: "center" }}>
      <ResponsiveContainer width="100%" height={height}>
        <RadialBarChart data={data} innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "var(--border, #334155)" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="faint" style={{ fontSize: 12 }}>
        已用 {used.toLocaleString()} / {budget.toLocaleString()}（{Math.round(pct * 100)}%）
      </div>
    </div>
  );
}

/** 数字滚动（无外部依赖，rAF 缓动）。 */
export function AnimatedNumber({
  value,
  duration = 600,
  format,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format ? format(display) : Math.round(display).toLocaleString()}</>;
}
