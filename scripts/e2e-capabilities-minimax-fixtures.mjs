// Editorial requests are independent of the descriptions shown in the provider schema.
const lines=`
tool_search 我要找能核对台词的工具，检索关键词“台词”，先给五个候选。
tool_schema_get 给我 artifact_list 的完整参数定义。
tool_invoke 通过通用延迟调用入口执行 artifact_list，参数 type=character。
skill_list 给我工作台已装的技能目录，最多十项。
skill_read 打开 manju/core-hook/SKILL.md 看选题步骤。
done_check 在结束本轮之前检查岗位交付条件是否全部完成。
gate_run 对所给正文做 DeAIChecklist 门禁。
artifact_create 新建题为《迟来的回执》的一句话选题卡，类型 logline，正文“护士凭一张过期回执追查失踪病人”。
artifact_list 列出当前项目的 character 产物，只要前三条。
bible_read 读人物圣经 bible/characters.md。
memory_search 用语义检索项目记忆里“回执是谁签的”相关片段。
artifact_update 更新给定正文的标题为《迟来的回执》，使用给定版本防止覆盖。
project_get 获取当前项目的格式和市场设置。
diff_artifacts 比较给定大纲与正文两件产物的差异。
export_doc 导出题为《回执》的文档，第一节标题“梗概”、内容“回执早于入院记录”。
usage_log 记录本次模型用量：输入120、输出47 tokens。
job_enqueue 把一次 export.docx 工作放入后台队列。
job_cancel 取消队列作业 job-test-47。
subagent_spawn 请把“核对回执日期矛盾”委派给一个 reviewer 子助手。
stage_lock 当前漫剧处于 S1_HOOK_BATCH，已完成 S0_SETUP，核对当前阶段是否允许推进。
table_write 制作两列表格，表头“人物、目的”，一行“林月、追回回执”。
ontology_action 准备一次本体动作提交，用 UpsertObject 登记 Character 对象“档案员林月”，并关联到给定项目。
ontology_query 查询项目支持的全部已映射产物类型。
bible_write 在 bible/premise.md 写入正式设定“回执签发时间早于入院”。
memory_get 按路径取回 bible/characters.md 的前20行记忆。
memory_list 浏览当前可访问的项目记忆文件清单。
memory_write 保存待证假设到 notes/clue.md，内容“回执可能伪造”。
lesson_note 把“先对照签发日期再判断因果”记为本岗位私有经验。
memory_merge 在 notes/clue.md 把“可能伪造”单处更新为“签名待核”，保留其他行。
memory_grep 精确搜索所有记忆中包含“签发日期”的行。
memory_freeze 冻结 notes/clue.md，保留当前版本。
kb_search 在内部知识库里搜“漫剧开篇反转”，只查方法论。
kb_read 打开知识库文档 给定文档 阅读前段。
kb_write_report 给 给定文档 保存一份结构拆解报告，结论“先抛回执疑点再揭签名”。
web_search 上互联网搜索本周短剧市场趋势，要求来源链接。
checklist_open 新建“交稿检查”清单，包括“核对姓名”和“核对日期”。
want_how_concretize 把主角想追回原件、靠值班记录定位、用登记册取证拆成具体行动。
cool_stack_score 评估三拍爽点是否堆叠：被拒绝查档、出示回执、当众拆穿谎言。
trope_coverage 检查重生、打脸两个桥段的题材覆盖率，最低命中数2。
option_enumerate 罗列“回执是谁签的”两个互斥备选：护士、值班主任。
spec_pitch_validate 核验提案材料数量：一句话梗概“护士发现错日回执”，人物2、大纲1、正文1。
clip_candidate_extract 从给定原文提取两个适合剪成预告的片段。
witness_suggest 为医院档案室的签名对质场景建议合理目击者。
voice_diversity_score 按说话人衡量声音区分度，甲说“请出示签收单”，乙说“嘘，柜子里”。
info_asymmetry_tag 给“护士见过原件，主任只见过复印件”这一拍标明信息差。
ner_realworld 从“上海市人民广场附近的张医生”里识别现实实体。
beat20_scaffold 为20集漫剧生成二十拍节奏骨架。
midpoint_locator 第一幕在第1集、中点第10集、结局第20集，定位中点翻转位置。
paywall_slots 规划第8、第16集的付费卡点。
payoff_ledger 登记伏笔“签名墨色”及其在第3集的回收。
suspense_budget_check 当前开放悬念有签名人、时间差和失踪者，检查悬念预算。
outline_table 把第1集“发现回执”、第2集“核对日期”编成分集大纲表。
exchange_chain_step 交换链第1步：拿到复印件，换取值班表。
one_plus_one_suggest 从“谁签了回执”这个开放悬念建议一个回答和一个新疑问。
hook_100word_check 检查给定正文开头一百字是否抓人。
scene_triple_validate 检验室内夜晚档案室一场的场景三要素。
format_scene_header 为第一集第一场、夜、内、档案室排标准场标。
same_loc_task_change_check 两场都在档案室，第一场找登记册，第二场核对指纹，检查同地点任务是否变化。
location_merge_suggest 为降低成本，评估档案室、资料室、医院走廊哪些地点可合并。
speak_aloud_lint 检查这句台词读出口是否拗口：“关于事情的一个处理的情况我已经进行了了解”。
speak_aloud_hint 为这句台词提供朗读停顿提示：“你看，签字那天，我还没入院。”
line_split_attitude_info_subtext 拆解台词“你还留着那张回执啊”的态度、信息和潜台词。
ab_pingpong_detect 检查这段台词是否是机械的甲乙轮流问答、每轮没有新增信息：“甲：你来了。乙：我来了。甲：你真的来了？乙：对，我来了。” 现在只做该检查对应的工具调用。
finger_simplify 简化金手指规则“每天一次看回执过去”“只能看三秒”“使用后失声一小时”。
prompt_render 渲染 manju.hook.batch 模板用于本轮核心梗生成。
prompt_validate_lock 核验已登记的 manju.hook.batch 模板锁定句，仅按模板ID核验。
prompt_4part_build 把“作为档案员核对回执日期，输出疑点清单”组织成标准四段提示。
lapi_checklist 对给定稿件执行 LAPI 四项清单；稿件路径 drafts/receipt.md。
scan_banned_phrases 扫描“她的眼神中闪过一丝复杂的情绪”中的禁用套话。
scan_length 检查给定原文是否符合800至1200字。
scan_hook_present 检查给定正文结尾有没有留住下一集的钩子。
regex_redline 按红线正则检查给定文字的违规表达。
decay_detect 各集长度依次为1100、980、750、510字，检测篇幅衰减。
duration_risk_flag 检查三拍“追车、停下对质、追忆童年”塞进一分钟的时长风险。
similarity_heuristic 比较原句“回执落在地上”和草稿“那张回执掉落在地面”的文字相似度。
fs_ls 浏览工作区 drafts 目录有哪些文件。
fs_read 读工作区 drafts/receipt.md。
fs_write 在工作区 drafts/receipt.md 新写“日期不对”。
fs_edit 在工作区 drafts/receipt.md 将“周一”精确替换为“周三”。
fs_grep 精确查找工作区中含有“回执”的行。
fs_find 按文件名在工作区查找所有 receipt.md。
search_tools 在可用能力目录检索“人物记忆”相关工具。
invoke_tool 通过通用调用器对 list_projects 提交空参数。
search_agents 搜索擅长对白审校的岗位。
search_knowledge 检索内部知识库里的“医院题材对话技巧”。
list_projects 列出最近的写作项目。
get_project 读取指定项目详情。
list_artifacts 列出指定项目的稿件产物。
record_writing_feedback 请记住我的写作偏好：“台词少用长句”。
adopt_artifact 将给定正文的当前版本采纳为正式稿。
run_agent 让岗位 qc.de_ai 对指定文稿做一次去AI腔审读。
create_fleet 为给定项目组建协作团队，目标“完成第一集审校”，成员为 qc.de_ai 和 topic.logline_title。
list_agents 列出所有可用岗位，先浏览岗位目录。
get_stage_graph 查看漫剧的阶段流程图。
list_proposals 列出我待处理的提案。
approve_proposal 模拟审批决策：同意提案 proposal-test-47。
cowrite 对“她打开柜子。回执上是明天。”协同续写一句。
read_memory 浏览当前项目已经存储的角色记忆。
write_memory 将项目记忆“护士林月”保存为“她保留一张错日回执”。
scratchpad 暂记便笺“下轮核对签发时间”，仅作草稿。
create_project 建立一个名为《错日回执》的漫剧项目。
schedule_task 每周一上午九点安排“复盘本周写作”任务，cron 为 0 9 * * 1。
crawl_hotspots 抓取今天的短剧平台热点榜。
navigate 在工作台跳转到 /projects 页面。
plan 拆解“交付第一集可拍剧本”目标，列出工作计划。
follow_up 明天上午九点跟进“核对责编反馈”。
agent_status 看看当前智能体运行状态。
stop_agent 停止指定运行，不再继续。
agent_ps 列出所有正在运行的助手进程。
agent_inspect 查看指定运行的详细进程信息。
agent_pause 暂停指定运行，保留恢复能力。
agent_resume 恢复指定的已暂停运行。
steer_agent 告诉正在运行的助手“只检查时间线”。
start_async_task 开启后台异步审查任务“核对第一集时间线”。
check_async_task 查看指定异步任务是否完成。
update_async_task 给指定异步任务追加消息“重点核对签发日”。
cancel_async_task 取消指定后台异步任务。
list_async_tasks 浏览后台异步任务清单。
read_artifact 打开指定正文产物阅读全文。
save_artifact 保存指定正文的修订，把标题改为《错日回执》。
list_artifact_versions 列出指定正文的所有历史版本。
rollback_artifact 将指定正文恢复至所给历史版本。
start_studio_batch 批量启动写作室工序：先选题再审校。
`.trim().split('\n');
export const intents=Object.fromEntries(lines.map(line=>line.split(/ (.*)/s).slice(0,2)));
for(const name of ['ls','read','write','edit','grep','find']) intents[name]=intents['fs_'+name];
