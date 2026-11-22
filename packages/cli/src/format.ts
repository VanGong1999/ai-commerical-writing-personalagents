import { getConfig } from "./config.js";

export function out(data: unknown, human?: string): void {
  const { json, quiet } = getConfig();
  if (quiet && !json) return;
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  if (human !== undefined) {
    process.stdout.write(human + (human.endsWith("\n") ? "" : "\n"));
    return;
  }
  if (typeof data === "string") {
    process.stdout.write(data + (data.endsWith("\n") ? "" : "\n"));
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function err(message: string): void {
  process.stderr.write(message + (message.endsWith("\n") ? "" : "\n"));
}

export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (!rows.length) return "(empty)";
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const header = columns.map((c, i) => pad(c, widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((r) => columns.map((c, i) => pad(String(r[c] ?? ""), widths[i])).join("  "));
  return [header, sep, ...body].join("\n");
}
