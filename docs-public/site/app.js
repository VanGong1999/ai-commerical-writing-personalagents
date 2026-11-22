const galleryItems = [
  ['主界面.png', 'studio', '主界面', '项目、近期活动与创作入口'],
  ['创作台首页.png', 'studio', '创作台首页', '格式驱动的创作地图与阶段状态'],
  ['灵感选题界面.png', 'studio', '灵感选题', '把灵感候选变成可比较的选题卡'],
  ['minimax-manju-saved-body.png', 'studio', '漫剧正文', '分集正文、旁注与版本交付'],
  ['创作台短剧正文.png', 'studio', '短剧正文', '场景化正文与节拍信息'],
  ['创作台章节正文小说效果.png', 'studio', '短篇章节正文', '小说章节编辑与连续写作'],
  ['minimax-male_long-saved-body.png', 'studio', '男频长篇', '金手指、升级循环与正文'],
  ['minimax-female_long-saved-body.png', 'studio', '女频长篇', '关系推进、情绪曲线与正文'],
  ['minimax-ip_adapt-saved-body.png', 'studio', 'IP 改编', '来源拆解与改编交付'],
  ['正文版本与历史建议.png', 'quality', '正文版本历史', '查看修订、建议与当前版本'],
  ['比较采纳ai建议.png', 'quality', '比较并采纳', '逐段比较 AI 建议，作者决定是否采纳'],
  ['情节优化.png', 'studio', '情节优化', '针对选中情节提出可执行修改'],
  ['创作台选中片段优化.png', 'studio', '选中片段优化', '范围明确的定向改写'],
  ['文件饮用机制.png', 'knowledge', '资料引用', '带来源和范围的选段引用'],
  ['创作台eval.png', 'quality', '创作台评测', '对产物进行结构化评估'],
  ['智能体全景图鉴.png', 'agents', '智能体全景图鉴', '浏览岗位、技能和协作关系'],
  ['智能体图鉴.png', 'agents', 'Agent 图鉴', '查看单个岗位的职责与工具'],
  ['agent工作台-漫剧主线编组30个智能体协作.png', 'agents', '漫剧主线编组', '多个专业岗位协作完成主线'],
  ['agent工作台后台任务-守护任务中心.png', 'agents', '守护任务中心', '查看后台任务、租约与运行状态'],
  ['agent工作台后台任务.png', 'agents', '后台任务', '查看守护任务列表、状态与可操作入口'],
  ['运行中任务.png', 'agents', '运行中任务', '查看任务进度、暂停与恢复'],
  ['agent-window-1.png', 'agents', 'Agent 执行窗口 1', '模型循环与工具过程'],
  ['agent-window-2.png', 'agents', 'Agent 执行窗口 2', '产物、Gate 与交接证据'],
  ['agent-window-3.png', 'agents', 'Agent 执行窗口 3', '任务结果和后续动作'],
  ['多智能体交接.png', 'agents', '多智能体交接', '把目标、缺口和产物交给下一岗位'],
  ['多智能体handoff.png', 'agents', 'Handoff 交接卡', '压缩后的稳定任务上下文'],
  ['多智能体质量评测.png', 'quality', '多智能体质量评测', '人工标注与多次运行对比'],
  ['右下角AI助手.png', 'agents', 'Personal Agent', '从自然语言请求开始派单'],
  ['AI同事当中同事资料.png', 'agents', 'AI 同事资料', '岗位身份、信任与知识范围'],
  ['ai同事当中新增同事.png', 'agents', '新增 AI 同事', '创建带职责与技能的岗位'],
  ['ai同事-song-right-信任.png', 'agents', '信任设置', '控制自动执行和确认边界'],
  ['colleague-song-right-记忆.png', 'quality', '同事记忆', '查看岗位经验与私有记忆'],
  ['ai同事例程.png', 'agents', '例程与主动提案', '定时扫描缺口并提出下一步'],
  ['ai同事编组预设.png', 'agents', '编组预设', '复用常见岗位组合'],
  ['ai同事舰队和提议.png', 'agents', '舰队与提议', '组织多人协作与人工确认'],
  ['ai同事-舰队提议部分.png', 'agents', '舰队提议', '审阅任务成员和执行范围'],
  ['kb.png', 'knowledge', '知识库首页', '文档、文件夹和检索入口'],
  ['知识库分析报告.png', 'knowledge', '分析报告', '把长文拆成可引用的结构化证据'],
  ['知识库拆书换元.png', 'knowledge', '拆书与换元', '提取故事源并生成改编方案'],
  ['kb-tropes.png', 'knowledge', '桥段库', '按来源定位可复用桥段'],
  ['测试多书.png', 'knowledge', '多书组合', '跨资料比较结构和风格'],
  ['热点采集.png', 'knowledge', '热点采集', '将公开榜单元数据转成选题线索'],
  ['热点榜单.png', 'knowledge', '热点榜单', '查看题材趋势与时间变化'],
  ['知识库爬虫数据源.png', 'knowledge', '数据源管理', '配置公开来源和采集范围'],
  ['知识库爬虫报告.png', 'knowledge', '爬虫报告', '保留来源、时间和抓取状态'],
  ['助手方法库skills界面.png', 'quality', 'Skill 方法库', '查看岗位方法和输出契约'],
  ['写作指令面板prompt.png', 'quality', 'Prompt 管理', '格式包、锁定规则与可调指令'],
  ['memory.png', 'quality', '记忆系统', '项目事实、经验与提案分层'],
  ['AI用量页面.png', 'quality', 'AI 用量', 'Token、缓存和成本估算'],
  ['数据看板.png', 'quality', '数据看板', '按项目、格式和状态观察产出'],
  ['settings.png', 'quality', '服务商设置', 'Provider、并发和功能开关'],
  ['飞书personalagent.png', 'agents', '飞书 Personal Agent', '在消息入口接收任务和进度'],
  ['飞书自动执行提案.png', 'agents', '飞书自动执行提案', '在授权边界内确认自动动作'],
  ['飞书定时提醒.png', 'agents', '飞书定时提醒', '定时唤醒、进度提醒与确认卡片'],
  ['../assets/guide/ai同事-编组向导.png', 'agents', '编组向导', '用向导快速组织协作岗位'],
  ['../assets/guide/colleague-presets-wizard-step2.png', 'agents', '岗位预设向导', '从预设进入可编辑的团队配置']
];

const gallery = document.querySelector('#gallery-grid');
const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightbox-image');
const lightboxCaption = document.querySelector('#lightbox-caption');

function renderGallery(filter = 'all') {
  if (!gallery) return;
  gallery.innerHTML = galleryItems
    .filter(([, kind]) => filter === 'all' || kind === filter)
    .map(([file, kind, title, description]) => `
      <figure class="gallery-item" data-kind="${kind}" tabindex="0" role="button" aria-label="查看${title}大图">
        <img src="${file.startsWith('../') ? file : `../assets/readme-picture/${encodeURIComponent(file)}`}" alt="${title}" loading="lazy" />
        <figcaption><b>${title}</b><small>${description}</small></figcaption>
      </figure>`).join('');
  gallery.querySelectorAll('.gallery-item').forEach((item) => {
    const open = () => {
      const img = item.querySelector('img');
      lightboxImage.src = img.src;
      lightboxImage.alt = img.alt;
      lightboxCaption.textContent = item.querySelector('figcaption').innerText;
      if (typeof lightbox.showModal === 'function') lightbox.showModal();
      else lightbox.setAttribute('open', '');
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
}

renderGallery();
document.querySelectorAll('.gallery-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.gallery-tab').forEach((button) => button.classList.remove('active'));
  tab.classList.add('active');
  renderGallery(tab.dataset.filter);
}));

document.querySelector('.lightbox-close')?.addEventListener('click', () => lightbox.close?.());
lightbox?.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close?.(); });

const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.desktop-nav');
menuButton?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});
nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
  if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
}), { threshold: .12 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

// Public capability directory: only repository catalog metadata is loaded here.
const directoryState = { kind: 'agents', query: '', filter: 'all', limit: 24, agents: [], skills: [], tools: [] };
const directoryEls = {
  grid: document.querySelector('#directory-grid'),
  status: document.querySelector('#directory-status'),
  more: document.querySelector('#directory-more'),
  search: document.querySelector('#directory-search'),
  filter: document.querySelector('#directory-filter'),
  tabs: document.querySelectorAll('.directory-tab'),
  agentCount: document.querySelector('#directory-agent-count'),
  skillCount: document.querySelector('#directory-skill-count'),
  toolCount: document.querySelector('#directory-tool-count')
};
const toolMeta = {
  subagent_spawn: ['编排', '写入', '派发并追踪子 Agent'], gate_run: ['质检', '读取', '运行质量门禁并返回证据'], stage_lock: ['编排', '写入', '锁定阶段与交接边界'],
  artifact_create: ['产物', '写入', '创建可版本化交付物'], artifact_list: ['产物', '读取', '列出项目产物与版本'], artifact_update: ['产物', '写入', '更新指定产物版本'], diff_artifacts: ['产物', '读取', '比较两个产物版本'], export_doc: ['产物', '写入', '导出文档或投稿文件'],
  project_get: ['项目', '读取', '读取项目事实与运行状态'], job_enqueue: ['编排', '写入', '把长任务放入后台队列'], job_cancel: ['编排', '写入', '取消尚未完成的后台任务'], usage_log: ['治理', '写入', '记录模型、缓存与用量'],
  bible_read: ['圣经', '读取', '读取项目 Bible 与创作约束'], bible_write: ['圣经', '写入', '写入经过确认的设定'], memory_search: ['记忆', '读取', '搜索岗位或项目记忆'], memory_get: ['记忆', '读取', '获取一条记忆详情'], memory_list: ['记忆', '读取', '列出记忆索引'], memory_write: ['记忆', '写入', '保存新的经验或事实'], lesson_note: ['记忆', '写入', '记录可复用教训'], memory_merge: ['记忆', '写入', '合并重复或冲突记忆'], memory_grep: ['记忆', '读取', '按关键词定位记忆'], memory_freeze: ['记忆', '写入', '冻结不应被自动改写的记忆'],
  kb_search: ['知识库', '读取', '按语义检索公开资料与报告'], kb_read: ['知识库', '读取', '读取知识库条目'], kb_write_report: ['知识库', '写入', '保存拆书或分析报告'], web_search: ['知识库', '读取', '搜索外部公开信息'],
  scan_banned_phrases: ['质检', '读取', '扫描敏感或禁用表达'], scan_length: ['质检', '读取', '检查字数与长度预算'], scan_hook_present: ['质检', '读取', '检查开篇钩子是否存在'], scene_triple_validate: ['质检', '读取', '检查场景三要素'], regex_redline: ['质检', '读取', '执行规则化红线检查'], speak_aloud_lint: ['质检', '读取', '检查口语化与朗读阻塞'], similarity_heuristic: ['质检', '读取', '估算重复与相似片段'], suspense_budget_check: ['质检', '读取', '检查悬念预算'], voice_diversity_score: ['质检', '读取', '评估角色声音差异'], duration_risk_flag: ['质检', '读取', '标记时长或制作风险'],
  prompt_validate_lock: ['治理', '读取', '校验提示词锁与可编辑边界'], prompt_render: ['治理', '读取', '渲染最终上下文提示词'], prompt_4part_build: ['治理', '读取', '构建四段式任务提示词'], tool_search: ['元工具', '元工具', '发现当前可用工具'], tool_schema_get: ['元工具', '元工具', '读取工具参数契约'], tool_invoke: ['元工具', '元工具', '按契约调用工具'], skill_list: ['元工具', '元工具', '列出可用 Skill'], skill_read: ['元工具', '元工具', '读取 Skill 说明'], done_check: ['治理', '读取', '检查任务是否满足完成契约']
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const cleanText = (value, max = 260) => String(value ?? '').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const chips = (items, accent = false) => (items || []).filter(Boolean).slice(0, 8).map((item) => `<span class="directory-chip${accent ? ' accent' : ''}">${escapeHtml(item)}</span>`).join('');
const toolInfo = (name) => {
  if (toolMeta[name]) return { category: toolMeta[name][0], risk: toolMeta[name][1], description: toolMeta[name][2] };
  const category = name.includes('memory') ? '记忆' : name.includes('kb') ? '知识库' : name.includes('gate') || name.includes('check') || name.includes('scan') ? '质检' : name.includes('artifact') ? '产物' : name.includes('prompt') || name.includes('skill') || name.includes('tool_') ? '元工具' : '运行时工具';
  const risk = /write|create|update|enqueue|cancel|spawn|freeze|merge|export|lock/.test(name) ? '写入' : '读取';
  return { category, risk, description: '运行时注册工具，具体参数以源码 Tool Catalog 为准。' };
};
function currentDirectoryItems() {
  const list = directoryState[directoryState.kind] || [];
  const query = directoryState.query.trim().toLowerCase();
  return list.filter((item) => {
    const filterValue = directoryState.kind === 'agents' ? item.team : directoryState.kind === 'skills' ? String(item.path || '').split('/')[0] : item.category;
    const haystack = JSON.stringify(item).toLowerCase();
    return (!query || haystack.includes(query)) && (directoryState.filter === 'all' || filterValue === directoryState.filter);
  });
}
function renderDirectory() {
  if (!directoryEls.grid) return;
  const all = currentDirectoryItems();
  const shown = all.slice(0, directoryState.limit);
  directoryEls.grid.innerHTML = shown.map((item) => {
    if (directoryState.kind === 'agents') {
      const formats = item.formats || item.format || [];
      return `<article class="directory-card"><div class="directory-card-head"><div><h3>${escapeHtml(item.name || item.id)}</h3><div class="directory-id">${escapeHtml(item.id)}</div></div><span class="directory-kind">Agent</span></div><p>${escapeHtml(cleanText(item.description || item.summary || ''))}</p><div class="directory-meta">${chips([item.team, item.persona, item.stage || item.when], true)}</div><div class="directory-chip-row">${chips(formats)}${chips(item.tools, true)}</div>${item.skillPath ? `<details><summary>查看绑定 Skill</summary><p>${escapeHtml(item.skillPath)} · 可调用 ${item.tools?.length || 0} 个工具</p></details>` : ''}</article>`;
    }
    if (directoryState.kind === 'skills') {
      const gateItems = Array.isArray(item.gates) ? item.gates : item.gates ? [item.gates] : [];
      const lockItems = Array.isArray(item.locks) ? item.locks : item.locks ? [item.locks] : [];
      return `<article class="directory-card"><div class="directory-card-head"><div><h3>${escapeHtml(item.name || item.id)}</h3><div class="directory-id">${escapeHtml(item.id)}</div></div><span class="directory-kind">Skill</span></div><p>${escapeHtml(cleanText(item.description || ''))}</p><div class="directory-meta">${chips([item.path], true)}</div><div class="directory-chip-row">${chips(gateItems, true)}${chips(lockItems)}</div>${item.body ? `<details><summary>查看方法摘要</summary><p>${escapeHtml(cleanText(item.body, 360))}</p></details>` : ''}</article>`;
    }
    return `<article class="directory-card"><div class="directory-card-head"><div><h3>${escapeHtml(item.name)}</h3><div class="directory-id">${escapeHtml(item.id)}</div></div><span class="directory-kind">Tool</span></div><p>${escapeHtml(item.description)}</p><div class="directory-meta">${chips([item.category, item.risk], true)}</div><details><summary>查看调用定位</summary><p>由 Agent allowlist 暴露；参数与权限以 services/agent-worker 的 Tool Catalog 为准。</p></details></article>`;
  }).join('');
  directoryEls.status.textContent = `显示 ${shown.length} / ${all.length} · 当前目录：${directoryState.kind === 'agents' ? 'Agents' : directoryState.kind === 'skills' ? 'Skills' : 'Tools'}`;
  directoryEls.more.hidden = shown.length >= all.length;
}
function refreshDirectoryFilter() {
  const list = directoryState[directoryState.kind] || [];
  const values = [...new Set(list.map((item) => directoryState.kind === 'agents' ? item.team : directoryState.kind === 'skills' ? String(item.path || '').split('/')[0] : item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  directoryEls.filter.innerHTML = `<option value="all">全部团队 / 类别</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  directoryState.filter = 'all';
}
async function loadDirectory() {
  if (!directoryEls.grid) return;
  try {
    const [agentResponse, skillResponse, toolResponse] = await Promise.all([fetch('../../packages/agent-runtime/agent-catalog.json'), fetch('../../packages/agent-runtime/skills/catalog.json'), fetch('../../services/agent-worker/src/toolCatalog.js')]);
    if (!agentResponse.ok || !skillResponse.ok || !toolResponse.ok) throw new Error('catalog unavailable');
    const agentJson = await agentResponse.json();
    const skillJson = await skillResponse.json();
    const toolSource = await toolResponse.text();
    directoryState.agents = agentJson.agents || [];
    directoryState.skills = skillJson.skills || [];
    const toolBlocks = toolSource.split('\n  },');
    directoryState.tools = toolBlocks.map((block) => {
      const name = block.match(/name:\s*["']([^"']+)["']/)?.[1];
      const rawCategory = block.match(/category:\s*["']([^"']+)["']/)?.[1];
      const rawRisk = block.match(/risk:\s*["']([^"']+)["']/)?.[1];
      if (!name) return null;
      const category = rawCategory === 'meta' ? '元工具' : rawCategory || toolInfo(name).category;
      const risk = rawRisk === 'meta' ? '元工具' : rawRisk === 'write' ? '写入' : '读取';
      const keywords = block.match(/keywords:\s*\[([\s\S]*?)\]/)?.[1]?.match(/["']([^"']+)["']/g)?.map((value) => value.slice(1, -1)) || [];
      return { id: name, name, category, risk, description: keywords.length ? `支持：${keywords.slice(0, 4).join('、')}` : toolInfo(name).description };
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    directoryEls.agentCount.textContent = directoryState.agents.length;
    directoryEls.skillCount.textContent = directoryState.skills.length;
    directoryEls.toolCount.textContent = directoryState.tools.length;
    refreshDirectoryFilter();
    renderDirectory();
  } catch (error) {
    directoryEls.status.textContent = '目录加载失败，请通过 GitHub 源码查看 catalog；页面未读取任何私密数据。';
    directoryEls.grid.innerHTML = '<article class="directory-card"><h3>公开目录暂时不可用</h3><p>静态托管环境未找到 catalog 文件。核心产品介绍、截图和上手指引仍可正常浏览。</p></article>';
  }
}
directoryEls.tabs.forEach((tab) => tab.addEventListener('click', () => { directoryEls.tabs.forEach((button) => button.classList.remove('active')); tab.classList.add('active'); directoryState.kind = tab.dataset.directoryTab; directoryState.limit = 24; refreshDirectoryFilter(); renderDirectory(); }));
directoryEls.search?.addEventListener('input', (event) => { directoryState.query = event.target.value; directoryState.limit = 24; renderDirectory(); });
directoryEls.filter?.addEventListener('change', (event) => { directoryState.filter = event.target.value; directoryState.limit = 24; renderDirectory(); });
directoryEls.more?.addEventListener('click', () => { directoryState.limit += 24; renderDirectory(); });
loadDirectory();

const interfaceSpecs = [
  { group:'创作入口', title:'项目首页 / Dashboard', id:'surface.dashboard', state:'implemented', lead:'让作者知道现在有哪些项目、哪些 Run 正在进行、哪些产物需要确认，以及下一步最值得做什么。', actions:'创建项目；选择六种创作格式；打开最近项目；查看运行中任务；进入 AI 同事；跳转知识库和用量。', input:'项目名称、格式、核心梗、近期操作筛选条件。', output:'项目卡片、阶段进度、待确认候选、失败或暂停提醒。', states:'空项目 → 已初始化 → 有候选 → 有待确认 → 已归档。', boundary:'作者与项目成员可见；只能看到已授权项目和可用动作。', recovery:'网络失败时保留已缓存的项目索引；Run 中断后从运行中心恢复，不重复覆盖已采纳版本。' },
  { group:'创作入口', title:'项目创建 / Format Setup', id:'surface.project-setup', state:'implemented', lead:'把一句灵感变成带格式、阶段图和约束的可执行项目。', actions:'选择漫剧、短剧、短篇、男频、女频或 IP 改编；填写核心梗和目标；确认默认阶段；初始化 Bible。', input:'格式、题材、受众、篇幅、禁用方向、交付时间和初始设定。', output:'项目事实、格式配置、Stage Graph、第一批 Setup 任务。', states:'草稿 → 校验中 → 已初始化 → 等待作者确认。', boundary:'初始化可以由作者触发；强制写入需通过 Schema / Gate；模型只能提出设定，不能替作者最终确认。', recovery:'字段不完整时给出缺口清单；重复初始化只生成候选，不覆盖已有 Bible。' },
  { group:'创作入口', title:'创作台 / Studio', id:'surface.studio', state:'implemented', lead:'以格式驱动的创作地图承载选题、人物、大纲、正文、分镜和投稿包。', actions:'切换阶段；查看任务依赖；创建候选；选择产物；编辑正文；比较版本；请求优化；交给下游 Agent。', input:'当前项目上下文、选中的产物/片段、目标阶段、风格要求和作者批注。', output:'候选产物、版本 diff、引用、Gate 结果、下一阶段任务。', states:'未开始 → 生成中 → 待比较 → 待采纳 → 已采纳 → 可下游消费。', boundary:'自动生成、人工采纳和正式交付分离；同一产物以版本和 CAS 保护，避免无声覆盖。', recovery:'长文本按集/章/场分块；单块失败只重试该块；冲突显示版本差异而不是直接覆盖。' },
  { group:'AI 同事', title:'AI 同事 / Personal Agent', id:'surface.ai-colleague', state:'implemented', lead:'借鉴 Grokbot 风格的“常驻助手 + 主动提案”交互：作者用自然语言交代目标，助手先理解、再提案、再执行。', actions:'直接对话；查看同事资料；创建或编辑同事；设定信任级别；查看记忆；让同事扫描缺口；接受、拒绝或改写提案。', input:'自然语言目标、项目范围、确认偏好、可用工具、信任设置和历史记忆。', output:'澄清问题、行动计划、候选结果、工具调用记录、待确认提案和下一步建议。', states:'倾听 → 澄清 → 提案 → 等待确认 → 执行 → 交付 → 复盘。', boundary:'这是交互模式的设计借鉴，不表示与 Grokbot 有隶属关系或复制其实现；高风险写入、外部发送和批量动作默认需要确认。', recovery:'助手不确定时必须暴露不确定性并请求补充；工具失败保留已完成步骤和 receipt；作者可暂停、撤销未提交提案。' },
  { group:'AI 同事', title:'同事资料 / Persona & Trust', id:'surface.colleague-profile', state:'implemented', lead:'把一个 AI 同事从“聊天机器人”变成有身份、边界、记忆和可审计权限的岗位。', actions:'编辑名字、职责、人格和工作范围；选择允许的工具；设置自动执行、建议执行或逐次确认；冻结/清理记忆。', input:'岗位说明、输入来源、可用格式、工具 allowlist、信任等级和记忆策略。', output:'可复用岗位档案、权限摘要、信任提示、记忆目录和测试任务。', states:'模板 → 草稿 → 已启用 → 暂停 → 复核中。', boundary:'工具 allowlist 优先于模型自述；岗位不能越权读取其他项目或绕过 Gate。', recovery:'权限变更只影响后续动作；正在运行的 Run 保留原始配置并记录差异。' },
  { group:'多智能体协作', title:'舰队提案 / Fleet Proposal', id:'surface.fleet-proposal', state:'runtime', lead:'总编把复杂目标拆成多个互相依赖的岗位，并在真正派发前让作者看到范围、成员和成本风险。', actions:'查看成员；调整并行/接力关系；删减不必要岗位；确认上下文范围；批准或拒绝整组提案。', input:'目标、格式、Stage、候选产物、所需能力和预算/并发策略。', output:'子任务列表、依赖 Graph、上下文包、预计调用量、风险提示和待确认动作。', states:'识别 → 组队 → 预览 → 作者确认 → 派发 → 汇聚。', boundary:'“148 个 Agent”是岗位目录，不是同时启动 148 个模型；并发由任务图、全局 LLM 闸和 Provider 限制共同决定。', recovery:'成员失败可替换或单独重试；依赖未满足时后续节点保持 blocked，不伪造完成。' },
  { group:'多智能体协作', title:'Handoff / 交接卡', id:'surface.handoff', state:'runtime', lead:'把一个岗位的目标、已知事实、缺口、产物和下一步压缩成下一个岗位能安全消费的任务包。', actions:'查看交接摘要；核对引用；追加作者备注；接受交接；退回补充；比较上下文压缩前后。', input:'上游产物、Gate 结果、证据引用、未决问题和下游职责。', output:'结构化 handoff、上下文边界、接收方检查清单和下一任务。', states:'待生成 → 已生成 → 待接收 → 已接收 → 退回补充。', boundary:'只传递与下游任务相关的事实和引用，避免把全部聊天记录灌入每次调用。', recovery:'交接丢失时从持久化 artifact / receipt 重建；版本不一致时要求重新确认。' },
  { group:'运行监控', title:'任务中心 / Run Monitor', id:'surface.run-monitor', state:'runtime', lead:'把长任务从黑盒等待变成可暂停、可观察、可恢复的执行记录。', actions:'查看阶段、子任务、工具调用、队列、租约、心跳和错误；暂停；恢复；取消；重试安全失败；导出运行报告。', input:'Run ID、过滤条件、错误类型、重试策略和作者指令。', output:'实时状态、时间线、receipt、失败分类、重试建议和最终交付摘要。', states:'queued → running → waiting_user → retrying → paused → completed / failed / cancelled。', boundary:'读操作可自动刷新；写操作按权限与确认规则执行；结果存疑的写入不自动重放。', recovery:'基于 checkpoint 和幂等键恢复；429 使用退避与全局闸；超时区分“未执行”和“执行结果未知”。' },
  { group:'知识与记忆', title:'知识库 / Knowledge Base', id:'surface.knowledge-base', state:'implemented', lead:'把公开资料、上传文档、拆书报告、桥段和热点线索变成可引用证据，而不是一堆无法追溯的文本。', actions:'上传/归档；按来源搜索；查看分析报告；拆书与换元；管理爬虫数据源；查看时间和版权提示。', input:'文档、URL、关键词、来源范围、分析模板和版权边界。', output:'条目、摘要、引用片段、来源清单、报告、桥段标签和检索结果。', states:'待处理 → 解析中 → 可检索 → 已引用 → 过期/需复核。', boundary:'只把相关片段注入当前岗位；引用保留来源与范围；研究素材不自动等于可复制或拥有改编权。', recovery:'解析失败保留原文件与错误报告；来源失效标记为需复核，不静默删除历史引用。' },
  { group:'知识与记忆', title:'Memory / 记忆与 Bible', id:'surface.memory', state:'runtime', lead:'分离项目事实、岗位经验、任务摘要和作者偏好，减少串项目、设定漂移与重复解释。', actions:'搜索、读取、写入、合并、冻结、删除记忆；查看来源；把候选经验提升为稳定规则。', input:'事实、作者确认、Run 结果、lesson note、引用和有效范围。', output:'分层记忆、版本、来源、置信度、过期时间和注入建议。', states:'候选 → 待确认 → 稳定 → 冻结 → 过期/冲突。', boundary:'模型生成的“事实”先作为候选；Bible 与作者确认优先于模糊记忆；跨项目注入需要明确范围。', recovery:'冲突保留两条来源并提示人工裁决；误写通过版本回滚和冻结恢复。' },
  { group:'质量与交付', title:'评测 / Gate & Eval', id:'surface.eval', state:'implemented', lead:'把“看起来不错”拆成结构、长度、钩子、格式、合规和完成契约等可复核信号。', actions:'运行 Gate；查看失败项；比较多次运行；人工打分；标记采纳；生成评测报告。', input:'候选产物、格式规则、检查项、人工标签和参考样例。', output:'PASS/FAIL、问题定位、receipt、修订建议、质量趋势和人工结论。', states:'未评测 → 检查中 → 通过/部分通过/失败 → 待人工确认。', boundary:'自动 Gate 只能检查定义过的维度；通过不等于好看、原创、可拍或商业成功。', recovery:'失败定位到具体字段/片段；修订后增量重跑；保留历史结果以便比较。' },
  { group:'质量与交付', title:'版本比较与采纳 / Diff & Adopt', id:'surface.adopt', state:'implemented', lead:'让作者对每一次 AI 改写拥有最终选择权，保留原文、建议、采纳范围和原因。', actions:'逐段比较；只采纳部分建议；编辑后采纳；拒绝；写采纳理由；生成下游版本。', input:'当前版本、候选版本、选中片段、作者批注和采纳策略。', output:'新版本、diff、Action 日志、采纳原因和可追溯父子关系。', states:'候选 → 比较中 → 部分采纳 → 已采纳 → 可继续编辑。', boundary:'不自动把建议覆盖成正文；作者确认是正式写入和下游传播的边界。', recovery:'错误采纳可回滚到父版本；冲突显示而不是覆盖；每次写入都有版本 ID。' },
  { group:'设置与连接', title:'设置 / Provider & Governor', id:'surface.settings', state:'implemented', lead:'集中管理模型供应商、并发闸、退避、缓存、用量和功能开关，让限流变成可解释配置。', actions:'选择 DeepSeek / MiniMax / Ollama；设置全局并发；调整 worker、subagents 和队列；查看缓存命中与 429；切换功能开关。', input:'Provider 凭据（仅后端）、模型、速率限制、并发上限、超时、重试和缓存策略。', output:'生效配置、健康状态、用量统计、限流事件和建议配置。', states:'未配置 → 检查中 → 可用 → 冷却 → 降级 / 不可用。', boundary:'前端不保存真实密钥；全局闸优先于局部 worker；提高 worker 不等于可以突破 Provider 限额。', recovery:'429 走指数退避与冷却；Provider 故障可切换；不确定写入不盲目重试。' },
  { group:'设置与连接', title:'飞书 / Personal Agent 入口', id:'surface.feishu', state:'runtime', lead:'让作者在消息入口接收进度、查看提案、回答澄清问题并确认自动动作。', actions:'发送目标；查看 Run；确认/拒绝提案；接收失败提醒；触发例程；跳转 Web 详情。', input:'消息、卡片按钮、项目范围、授权状态和回调签名。', output:'任务回执、进度卡、提案卡、确认结果和深链。', states:'收到 → 校验 → 派发 → 等待确认 → 回执。', boundary:'只处理已验证来源和已授权项目；外部消息不直接绕过 Web 侧的权限与 Gate。', recovery:'回调重复使用幂等键；消息发送失败仍以 Web Run 为准；用户可回到任务中心继续。' },
  { group:'设置与连接', title:'导出 / 投稿与 LLM Wiki Export', id:'surface.export', state:'runtime', lead:'把已确认、已通过门禁的产物整理成可交付文件或知识库导入包。', actions:'选择产物范围；选择格式；生成 Markdown / 文档；导出来源清单；执行敏感信息检查；下载或交给 ingest。', input:'已采纳产物、元数据、来源、版权边界、模板和导出目标。', output:'版本化文件、frontmatter、索引、校验报告和导出 receipt。', states:'准备 → 校验 → 生成 → 可下载 → 已归档。', boundary:'只导出作者选择和权限允许的内容；导出前检查密钥、Session、个人隐私和来源边界。', recovery:'校验失败不生成可发布包；已生成包可由 receipt 复现；原项目内容不被导出器改写。' }
];
const atlasState = { query: '' };
const atlasGrid = document.querySelector('#atlas-grid');
const atlasCount = document.querySelector('#atlas-count');
const atlasSearch = document.querySelector('#atlas-search');
function renderAtlas() {
  if (!atlasGrid) return;
  const query = atlasState.query.trim().toLowerCase();
  const items = interfaceSpecs.filter((spec) => !query || JSON.stringify(spec).toLowerCase().includes(query));
  atlasGrid.innerHTML = items.map((spec) => `<article class="atlas-card"><div class="atlas-card-head"><div><h3>${escapeHtml(spec.title)}</h3><div class="atlas-id">${escapeHtml(spec.id)} · ${escapeHtml(spec.group)}</div></div><span class="atlas-state ${spec.state}">${spec.state === 'implemented' ? '已有界面' : spec.state === 'runtime' ? '运行时能力' : '规划增强'}</span></div><p class="atlas-card-lead">${escapeHtml(spec.lead)}</p><div class="atlas-detail-grid"><div class="atlas-detail"><b>用户可以做什么</b><p>${escapeHtml(spec.actions)}</p></div><div class="atlas-detail"><b>输入</b><p>${escapeHtml(spec.input)}</p></div><div class="atlas-detail"><b>输出 / 证据</b><p>${escapeHtml(spec.output)}</p></div><div class="atlas-detail"><b>状态流转</b><p>${escapeHtml(spec.states)}</p></div><div class="atlas-detail"><b>权限与边界</b><p>${escapeHtml(spec.boundary)}</p></div><div class="atlas-detail"><b>失败与恢复</b><p>${escapeHtml(spec.recovery)}</p></div></div></article>`).join('') || '<article class="atlas-card"><h3>没有匹配界面</h3><p class="atlas-card-lead">换一个关键词，或回到“全部”查看完整产品地图。</p></article>';
  atlasCount.textContent = `显示 ${items.length} / ${interfaceSpecs.length} 个界面规格`;
}
renderAtlas();
atlasSearch?.addEventListener('input', (event) => { atlasState.query = event.target.value; renderAtlas(); });

const architectureData = {
  graph: { title:'Graph：把复杂创作拆成有依赖的任务网络', intro:'Graph 不是一张装饰性的流程图，而是任务调度的边界。每个节点代表一个可验证的工作单元，边代表数据依赖、阶段顺序、人工确认或资源约束。只有前置节点产出满足契约，下游 Agent 才能消费。', nodes:[['01','Intent','把自然语言目标解析成格式、范围和交付物'],['02','Plan','总编生成 Stage Graph、角色和依赖'],['03','Parallel','选题、人物、资料等互不冲突的节点并行'],['04','Gate','Schema、引用、长度和质量门禁拦截错误'],['05','Adopt','作者确认后写入版本并解锁下游']], evidence:[['节点状态','queued / running / blocked / waiting_user / completed，每种状态都能解释“为什么停在这里”。'],['边的意义','依赖边传递产物与证据；冲突边阻止两个 Agent 同时覆盖同一版本。'],['恢复方式','从最后一个 checkpoint 重建未完成子图，不重复已确认写入。']] },
  loop: { title:'Loop：Agent 不是一次回答，而是一轮受控执行', intro:'每次 Agent 工作都在 Observe → Decide → Act → Verify 的循环中运行。模型可以提出下一步，但工具、权限、写入和完成状态由运行时决定。循环直到完成契约满足、需要人工确认，或遇到不可安全重试的错误。', nodes:[['01','Observe','读取任务包、Bible、相关记忆、当前产物和 Gate'],['02','Decide','选择 Skill、工具和下一步；暴露假设与不确定性'],['03','Act','调用搜索、记忆、产物、质检或子 Agent 工具'],['04','Verify','检查返回值、权限、Schema、receipt 和副作用'],['05','Continue','继续、暂停、交接、重试或结束并提交证据']], evidence:[['工具闸','Tool allowlist、风险级别和全局 LLM 并发闸控制动作范围。'],['写入闸','创建/更新产物、Bible、记忆和外部发送都要区分候选与正式写入。'],['结束条件','Done Contract 不看模型一句“完成”，而看产物、校验、引用和持久化证据。']] },
  context: { title:'Context Engineering：给每次调用最小但足够的上下文', intro:'上下文工程不是把更多文本塞进 Prompt，而是按任务需要装配稳定事实、近期状态、相关记忆、工具契约和输出格式，并在交接时压缩、标注来源和限制范围。目标是减少漂移、串项目、Token 浪费与错误自信。', nodes:[['01','Scope','绑定 project / format / stage / artifact，先确定“这次只处理什么”'],['02','Stable','注入 Bible、作者确认、格式规则和不可变约束'],['03','Relevant','检索与当前片段相关的记忆、知识库引用和上游产物'],['04','Operate','按需暴露 Skill、Tool schema、权限和输出契约'],['05','Compress','生成 handoff、摘要、引用和未决问题，传给下一个岗位']], evidence:[['分层','系统规则、项目事实、岗位记忆、任务摘要和用户输入分层，避免互相污染。'],['证据','每条关键事实尽量带来源、版本、时间或作者确认状态，冲突时不静默合并。'],['成本与稳定','只注入相关窗口；缓存稳定前缀；长任务用摘要与 checkpoint 延续，而不是重放全部对话。']] }
};
function renderArchitecture(kind) {
  const data = architectureData[kind];
  const panel = document.querySelector(`#architecture-${kind}`);
  if (!panel || !data) return;
  panel.innerHTML = `<div class="arch-copy"><span class="arch-kicker">${kind === 'graph' ? '01 / GRAPH' : kind === 'loop' ? '02 / LOOP' : '03 / CONTEXT ENGINEERING'}</span><h3>${escapeHtml(data.title)}</h3><p>${escapeHtml(data.intro)}</p></div><div class="arch-flow">${data.nodes.map(([number, title, text]) => `<div class="arch-node"><span>${number}</span><b>${escapeHtml(title)}</b><small>${escapeHtml(text)}</small></div>`).join('')}</div><div class="arch-evidence">${data.evidence.map(([title, text]) => `<div><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div>`).join('')}</div>`;
}
['graph', 'loop', 'context'].forEach(renderArchitecture);
