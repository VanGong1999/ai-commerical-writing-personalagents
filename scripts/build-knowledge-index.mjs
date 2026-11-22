#!/usr/bin/env node
/**
 * Scan knowledge markdown files and write/validate 00-meta/search-index.json.
 * Metadata only (no article body duplication).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const KNOWLEDGE = path.join(ROOT, "knowledge");
const OUT = path.join(KNOWLEDGE, "00-meta", "search-index.json");

const SKIP_DIRS = new Set(["00-meta"]);
/** Skip only the top-level knowledge README; keep category index READMEs (e.g. 15-prompts). */
const SKIP_ABS = new Set([path.join(KNOWLEDGE, "README.md")]);

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, acc);
    } else if (name.endsWith(".md") && !SKIP_ABS.has(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function parseMeta(text, rel) {
  const lines = text.split(/\r?\n/);
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = (titleLine ? titleLine.slice(2) : path.basename(rel, ".md")).trim();

  const meta = {};
  for (const l of lines.slice(0, 12)) {
    const m = l.match(/^>\s*([^：:]+)[：:]\s*(.+)\s*$/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }

  let summary = "";
  const yi = lines.findIndex((l) => /^##\s*一句话/.test(l));
  if (yi >= 0) {
    for (let i = yi + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (t.startsWith("#")) break;
      summary = t.replace(/^[-*>\s]+/, "");
      break;
    }
  }
  if (!summary) summary = title;
  if (summary.length > 120) summary = summary.slice(0, 117) + "…";

  const category = rel.split("/")[0] || "";
  const id = path.basename(rel, ".md");
  const auth = meta["权威级别"] || meta["权威"] || "P1";
  const skills = splitList(meta["关联 Skills"] || meta["关联Skills"] || "");
  const agents = splitList(meta["关联 Agents"] || meta["关联Agents"] || "");
  const tags = deriveTags(category, title, skills, meta["来源"] || "");

  return {
    id,
    path: rel.replace(/\\/g, "/"),
    title,
    category,
    tags,
    authority: auth,
    relatedSkills: skills.filter((s) => s && s !== "—"),
    relatedAgents: agents.filter((s) => s && s !== "—"),
    summary,
  };
}

function splitList(s) {
  return s
    .split(/[,，、/|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function deriveTags(category, title, skills, source) {
  const tags = new Set();
  if (category) tags.add(category.replace(/^\d+-/, ""));
  for (const s of skills) {
    if (s.includes(".")) tags.add(s.split(".")[0]);
    else if (s !== "—") tags.add(s);
  }
  const srcBits = source.split(/[\/／]/).map((x) => x.trim()).filter(Boolean);
  for (const b of srcBits.slice(0, 2)) {
    if (b.length <= 12) tags.add(b);
  }
  // light title tokens
  for (const t of title.match(/[\u4e00-\u9fff]{2,6}|[A-Za-z][\w-]{1,}/g) || []) {
    if (tags.size >= 8) break;
    tags.add(t);
  }
  return [...tags].slice(0, 10);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const files = walk(KNOWLEDGE).sort();
  const articles = files.map((full) => {
    const rel = path.relative(KNOWLEDGE, full);
    return parseMeta(fs.readFileSync(full, "utf8"), rel);
  });

  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    count: articles.length,
    articles,
  };

  if (checkOnly && fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const prevIds = new Set((prev.articles || prev).map((a) => a.id));
    const nextIds = new Set(articles.map((a) => a.id));
    const missing = [...nextIds].filter((id) => !prevIds.has(id));
    const extra = [...prevIds].filter((id) => !nextIds.has(id));
    if (missing.length || extra.length || (prev.count ?? prev.articles?.length) !== articles.length) {
      console.error("index drift:", { missing, extra, expected: articles.length });
      process.exit(1);
    }
    console.log(`OK: ${articles.length} entries match ${path.relative(ROOT, OUT)}`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${articles.length} entries → ${path.relative(ROOT, OUT)}`);
}

main();
