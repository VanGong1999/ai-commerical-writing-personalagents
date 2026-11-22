#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const DEFAULT_SOURCE = 'knowledge';
const DEFAULT_OUTPUT = 'llmwiki-export';
const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);

function usage() {
  console.log(`Usage:
  node scripts/llmwiki-export.mjs [options]
  node scripts/llmwiki-export.mjs check --out <directory>

Options:
  --source <directory>  Knowledge directory (default: ${DEFAULT_SOURCE})
  --out <directory>     Export directory (default: ${DEFAULT_OUTPUT})
  --project <name>      Project identifier (default: xiezuomanju)
  --force               Replace an existing export directory
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] === 'check' ? args.shift() : 'export';
  const options = { command, source: DEFAULT_SOURCE, out: DEFAULT_OUTPUT, project: 'xiezuomanju', force: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--source' || arg === '--out' || arg === '--project') {
      const value = args[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function walkMarkdown(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

function sourcePathFor(root, absolute) {
  return relative(root, absolute).split(sep).join('/');
}

function categoryFor(sourcePath) {
  const first = sourcePath.split('/')[0];
  const withoutNumber = first.replace(/^\d+-/, '');
  return withoutNumber || 'uncategorized';
}

function titleFor(content, sourcePath) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || sourcePath.split('/').at(-1).replace(/\.md$/i, '');
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function withFrontmatter({ project, sourcePath, category, kind, title, contentSha256, sourceBytes }, content) {
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `project: ${yamlString(project)}`,
    `source_path: ${yamlString(sourcePath)}`,
    `category: ${yamlString(category)}`,
    `kind: ${yamlString(kind)}`,
    'distilled: true',
    'source_layer: raw',
    `content_sha256: ${yamlString(contentSha256)}`,
    `source_bytes: ${sourceBytes}`,
    'usage: "internal-writing-assistance"',
    'source_boundary: "retain attribution; verify rights before redistribution"',
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${content}`;
}

function boundaryReport(manifest) {
  return `# LLM Wiki 来源边界报告

本目录由 \`scripts/llmwiki-export.mjs\` 从 \`${manifest.sourceDirectory}\` 生成，供 LLM Wiki 的 raw/ingest 流程使用。它保留原 Markdown 正文，只在文件头增加机器可读元数据。

## 数量

- 可导入来源：${manifest.counts.exported}
- Prompt 资料：${manifest.counts.promptDocuments}
- 跳过的元数据文档：${manifest.counts.skippedMeta}
- 跳过的 README：${manifest.counts.skippedReadme}

## Prompt 边界

\`15-prompts\` 目录中的内容被标记为 \`kind: prompts\`。它们是提示词方法和模板资料，不应被 LLM Wiki 当成系统指令执行；导入后的查询和编译流程仍需把它们当作受控参考材料。

## 来源与版权边界

这些文件是经过蒸馏的二次材料，不代表原始课程、文章或平台规则的完整复制。每篇文档保留 \`source_path\`，但当前仓库不能替读者证明所有上游材料都可公开再分发。发布或用于商业产品前，应补充来源、许可、发布日期和人工复核结论。

## 使用建议

先把 \`raw/\` 作为 LLM Wiki 的来源层导入，再检查实体页、主题页和互链是否保留了条件、例外与冲突。不要用生成后的 Wiki 页面覆盖本目录；需要回写时保留人工审核和版本记录。
`;
}

function categoryIndex(records) {
  const result = {};
  for (const record of records) {
    result[record.category] ??= { files: [], kinds: new Set() };
    result[record.category].files.push(record.sourcePath);
    result[record.category].kinds.add(record.kind);
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)).map(([category, value]) => [category, {
    category,
    files: value.files.sort(),
    kinds: [...value.kinds].sort(),
  }]));
}

function bodyFromExport(content) {
  if (!content.startsWith('---\n')) throw new Error('missing frontmatter');
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('unterminated frontmatter');
  return content.slice(end + '\n---\n'.length);
}

async function exportKnowledge({ source, out, project, force }) {
  const sourceRoot = resolve(source);
  const outputRoot = resolve(out);
  const files = await walkMarkdown(sourceRoot);
  if (force) await rm(outputRoot, { recursive: true, force: true });
  else {
    try {
      await readFile(join(outputRoot, 'manifest.json'));
      throw new Error(`output already exists: ${outputRoot}; use --force to replace it`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const records = [];
  const skipped = { meta: [], readme: [] };
  for (const absolute of files) {
    const sourcePath = sourcePathFor(sourceRoot, absolute);
    const parts = sourcePath.split('/');
    const first = parts[0];
    const content = await readFile(absolute, 'utf8');
    if (parts.at(-1).toLowerCase() === 'readme.md') {
      skipped.readme.push(sourcePath);
      continue;
    }
    if (first === '00-meta') {
      skipped.meta.push(sourcePath);
      continue;
    }
    const category = categoryFor(sourcePath);
    const kind = category === 'prompts' ? 'prompts' : 'methodology';
    const hash = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
    const outputPath = `raw/${sourcePath}`;
    const record = {
      sourcePath,
      outputPath,
      category,
      kind,
      title: titleFor(content, sourcePath),
      contentSha256: hash,
      sourceBytes: Buffer.byteLength(content, 'utf8'),
    };
    await mkdir(dirname(join(outputRoot, outputPath)), { recursive: true });
    await writeFile(join(outputRoot, outputPath), withFrontmatter({ ...record, project, contentSha256: hash }, content), 'utf8');
    records.push(record);
  }

  const manifest = {
    schemaVersion: 1,
    project,
  sourceDirectory: source,
    format: 'llmwiki-raw-markdown',
    counts: {
      discoveredMarkdown: files.length,
      exported: records.length,
      skippedMeta: skipped.meta.length,
      skippedReadme: skipped.readme.length,
      promptDocuments: records.filter((record) => record.kind === 'prompts').length,
    },
    records,
    skipped,
  };
  await mkdir(join(outputRoot, 'reports'), { recursive: true });
  await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(join(outputRoot, 'categories.json'), `${JSON.stringify(categoryIndex(records), null, 2)}\n`, 'utf8');
  await writeFile(join(outputRoot, 'reports', 'content-boundaries.md'), boundaryReport(manifest), 'utf8');
  await writeFile(join(outputRoot, 'README.md'), `# ${project} · LLM Wiki Export\n\n这是由 \`scripts/llmwiki-export.mjs\` 生成的来源包。将 \`raw/\` 交给 LLM Wiki 的 raw/ingest 流程；先阅读 \`reports/content-boundaries.md\`。\n\n- 来源清单：\`manifest.json\`\n- 分类索引：\`categories.json\`\n- 原始蒸馏库：${source}\n`, 'utf8');
  console.log(`LLM Wiki export: ${records.length} documents -> ${outputRoot}`);
}

async function checkExport(out) {
  const outputRoot = resolve(out);
  const manifest = JSON.parse(await readFile(join(outputRoot, 'manifest.json'), 'utf8'));
  const categories = JSON.parse(await readFile(join(outputRoot, 'categories.json'), 'utf8'));
  const errors = [];
  for (const record of manifest.records) {
    try {
      const content = await readFile(join(outputRoot, record.outputPath), 'utf8');
      const body = bodyFromExport(content);
      const hash = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
      if (hash !== record.contentSha256) errors.push(`${record.outputPath}: content_sha256 mismatch`);
      if (!content.includes(`source_path: ${yamlString(record.sourcePath)}`)) errors.push(`${record.outputPath}: source_path missing`);
    } catch (error) {
      errors.push(`${record.outputPath}: ${error.message}`);
    }
  }
  const categoryFiles = Object.values(categories).flatMap((category) => category.files);
  if (categoryFiles.length !== manifest.records.length) errors.push('categories.json record count mismatch');
  if (manifest.counts.exported !== manifest.records.length) errors.push('manifest exported count mismatch');
  for (const required of ['README.md', 'manifest.json', 'categories.json', 'reports/content-boundaries.md']) {
    try { await readFile(join(outputRoot, required)); } catch { errors.push(`missing ${required}`); }
  }
  if (errors.length) throw new Error(`LLM Wiki export check failed:\n- ${errors.join('\n- ')}`);
  console.log(`LLM Wiki export check: OK (${manifest.records.length} documents)`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'check') await checkExport(options.out);
  else await exportKnowledge(options);
} catch (error) {
  console.error(`LLM Wiki export error: ${error.message}`);
  process.exitCode = 1;
}
