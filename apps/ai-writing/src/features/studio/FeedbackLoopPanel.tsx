import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Artifact } from '@xiezuomanju/domain';
import { Badge, Button, CollapsibleSection, EmptyBlock, Select, toast } from '@xiezuomanju/ui';
import { useState } from 'react';
import { feedbackApi, type Decision, type Outcome, type PersonalizationProfile } from '../../api/feedbackLoop';

const decisions: Record<Decision, string> = { adopt: '采用', revise: '需修改', discard: '放弃' };
const outcomes: Record<Outcome, string> = { unknown: '未知 / 未回填', draft: '草稿', submitted: '已投稿', accepted: '已过稿', rejected: '已退稿', published: '已发布' };
const reasons = [
  { value: '', label: '原因选填' }, { value: 'W06', label: '动作画面不足' },
  { value: 'W08', label: '悬念不足' }, { value: 'W15', label: '角色声口相似' },
  { value: 'W11', label: '因果或节奏问题' },
];

function OptionSelect({label, options, ...props}: {label: string; options: {value: string; label: string}[]; value: string; onChange: (event: {target: {value: string}}) => void}) {
  return <label className="stack" style={{ gap: 4 }}>{label}<Select {...props}>{options.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}</Select></label>;
}

export function FeedbackLoopPanel({ projectId, artifacts, format }: { projectId?: string; artifacts: Artifact[]; format: string }) {
  if (!projectId) return <EmptyBlock title="未选择项目" description="打开项目后可查看反馈与写作偏好。" />;
  return <ProjectFeedback key={projectId} projectId={projectId} artifacts={artifacts} format={format} />;
}

function ProjectFeedback({ projectId, artifacts, format }: { projectId: string; artifacts: Artifact[]; format: string }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['feedback-loop', projectId], queryFn: () => feedbackApi.overview(projectId) });
  const [artifactId, setArtifactId] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('unknown');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [minutes, setMinutes] = useState('');
  const [revenue, setRevenue] = useState('');
  const [scope, setScope] = useState(format);
  const [preference, setPreference] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const refresh = () => qc.invalidateQueries({ queryKey: ['feedback-loop'] });
  const save = useMutation({
    mutationFn: () => {
      const artifact = artifacts.find(a => a.id === artifactId);
      return feedbackApi.submit(projectId, {
        ...(artifact ? { artifactId: artifact.id, artifactVersion: artifact.version } : {}),
        decision, outcome, reason, note: note.trim(),
        manualMinutes: minutes === '' ? null : Number(minutes), revenue: revenue === '' ? null : Number(revenue),
        idempotencyKey: requestKey,
      });
    },
    onSuccess: () => {
      setDecision(null); setOutcome('unknown'); setReason(''); setNote(''); setMinutes(''); setRevenue('');
      setRequestKey(crypto.randomUUID()); void refresh(); toast.ok('反馈已保存');
    },
  });
  const profile = useMutation({ mutationFn: (input: Partial<PersonalizationProfile>) => feedbackApi.updateProfile(input), onSuccess: () => { setPreference(''); void refresh(); } });
  const reset = useMutation({ mutationFn: feedbackApi.resetProfile, onSuccess: () => { setResetOpen(false); void refresh(); toast.ok('已清空偏好并关闭个性化'); } });
  const data = query.data;
  const personal = data?.personalization;
  const pending = profile.isPending || reset.isPending;
  const error = save.error || profile.error || reset.error;
  const numericInvalid = [minutes, revenue].some(v => v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) || Number(minutes) > 1_000_000 || Number(revenue) > 1e12;
  const canSave = decision || outcome !== 'unknown' || reason || note.trim() || minutes !== '' || revenue !== '';
  const addPreference = (text: string, preferenceFormat = scope) => {
    if (!personal || personal.preferences.length >= 8) return;
    profile.mutate({ preferences: [...personal.preferences, { text, format: preferenceFormat }] });
  };

  return <div className="stack" style={{ gap: 14, marginTop: 12 }}>
    <div><strong>反馈与个人偏好</strong><p className="muted" style={{ fontSize: 12 }}>不填也能继续创作。采用与修改只代表使用行为；投稿结果和收入由你选填。</p></div>
    {query.isPending && <p className="muted">读取反馈…</p>}
    {query.isError && <div role="alert"><p>反馈暂时无法读取：{query.error.message}</p><Button size="sm" onClick={() => void query.refetch()}>重试</Button></div>}
    {data && <>
      <div className="stack" style={{ gap: 6 }}>
        <Badge>已观察 · 当前项目</Badge>
        <p style={{ margin: 0, fontSize: 12 }}>保存修改 {data.observed.userEditCount} 次（含工具修改） · 已采用 {data.observed.adoptedCount} 份 · 回滚 {data.observed.rollbackCount} 次</p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>修改字数：{data.observed.revisionChars ?? '未统计'}；这些记录不能证明过稿、拒稿或商业回报。</p>
      </div>
      <fieldset disabled={save.isPending} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, gap: 10 }}>
      <OptionSelect label="反馈对象" value={artifactId} onChange={e => { setArtifactId(e.target.value); setRequestKey(crypto.randomUUID()); }} options={[{ value: '', label: '整个项目' }, ...artifacts.map(a => ({ value: a.id, label: `${a.title} · v${a.version}` }))]} />
      <div className="row" role="group" aria-label="采用反馈" style={{ gap: 6, flexWrap: 'wrap' }}>
        {(Object.entries(decisions) as [Decision, string][]).map(([value, label]) => <Button key={value} size="sm" aria-pressed={decision === value} variant={decision === value ? 'primary' : 'ghost'} onClick={() => { setDecision(decision === value ? null : value); setRequestKey(crypto.randomUUID()); }}>{label}</Button>)}
      </div>
      <OptionSelect label="原因（可跳过）" value={reason} onChange={e => { setReason(e.target.value); setRequestKey(crypto.randomUUID()); }} options={reasons} />
      <CollapsibleSection title="投稿结果、耗时与备注（选填）" defaultOpen={false}>
        <div className="stack" style={{ gap: 10 }}>
          <OptionSelect label="稿件结果 · 用户声明" value={outcome} onChange={e => { setOutcome(e.target.value as Outcome); setRequestKey(crypto.randomUUID()); }} options={Object.entries(outcomes).map(([value, label]) => ({ value, label }))} />
          <label className="stack">人工修改耗时（分钟）<input className="input" type="number" min="0" max="1000000" step="any" placeholder="未知，留空" value={minutes} onChange={e => { setMinutes(e.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
          <label className="stack">已确认收入（元）<input className="input" type="number" min="0" max="1000000000000" step="any" placeholder="未知，留空；0 需主动填写" value={revenue} onChange={e => { setRevenue(e.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
          <label className="stack">补充说明<textarea className="input" rows={3} maxLength={2000} value={note} onChange={e => { setNote(e.target.value); setRequestKey(crypto.randomUUID()); }} placeholder="可直接跳过" /></label>
        </div>
      </CollapsibleSection>
      <Button size="sm" disabled={!canSave || numericInvalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? '保存中…' : '保存反馈'}</Button>
      </fieldset>
      {error && <p role="alert">保存失败：{error.message}</p>}
      <CollapsibleSection title="个性化建议与控制">
        {personal && <div className="stack" style={{ gap: 10 }}>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={personal.enabled} disabled={pending} onChange={e => profile.mutate({ enabled: e.target.checked })} />在后续创作中使用个人偏好</label>
          <p className="muted" style={{ fontSize: 12 }}>只有已确认的偏好会用于后续创作。重复反馈可形成待确认建议。</p>
          {personal.preferences.map((p, i) => <div className="stack" key={`${p.format}-${p.text}`}><span>{p.text} <Badge>已确认 · {p.format === '*' ? '全部格式' : p.format}</Badge></span><Button size="sm" variant="ghost" disabled={pending} onClick={() => profile.mutate({ preferences: personal.preferences.filter((_, n) => n !== i) })}>移除偏好</Button></div>)}
          <OptionSelect label="偏好适用范围" value={scope} onChange={e => setScope(e.target.value)} options={[{value: format, label: "当前格式"}, {value: "*", label: "全部格式"}]} />
          <label className="stack">添加写作偏好<input className="input" disabled={pending} value={preference} maxLength={180} placeholder="例如：对白简短，多用动作推进" onChange={e => setPreference(e.target.value)} /></label>
          <Button size="sm" disabled={pending || !preference.trim() || personal.preferences.length >= 8} onClick={() => addPreference(preference.trim())}>确认偏好（{personal.preferences.length}/8）</Button>
          {personal.suggestions.length === 0 && <p className="muted" style={{ fontSize: 12 }}>暂无足够的重复明确反馈，尚未形成偏好建议。</p>}
          {personal.suggestions.map(s => <div className="stack" key={s.text}><span>{s.text}</span><span className="muted" style={{ fontSize: 12 }}>待确认 · {s.evidenceCount} 条明确反馈 · 证据强度 {Math.round(s.confidence * 100)}%（启发式，非准确率）</span>{s.sources?.map((source,i) => <small key={i}>项目 {source.projectId} · 稿件 {source.artifactId ?? "未关联"} · 版本 {source.artifactVersion ?? "未记录"}</small>)}<Button size="sm" disabled={pending || personal.preferences.length >= 8 || personal.preferences.some(p => p.text === s.text)} onClick={() => addPreference(s.text, s.format ?? format)}>确认此偏好</Button></div>)}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setResetOpen(true)}>重置个性化</Button>
          {resetOpen && <div role="group" aria-label="确认重置个性化"><p>清空已确认偏好并关闭个性化；保留历史反馈用于核对。</p><div className="row"><Button size="sm" disabled={pending} onClick={() => reset.mutate()}>确认重置</Button><Button size="sm" variant="ghost" onClick={() => setResetOpen(false)}>取消</Button></div></div>}
        </div>}
      </CollapsibleSection>
      <CollapsibleSection title={`已声明的反馈（${data.events.length}）`} defaultOpen={false}>
        {!data.events.length && <p className="muted">尚无手动反馈。商业结果保持未知。</p>}
        {data.events.map(event => <div key={event.id} className="stack" style={{ marginBottom: 12, fontSize: 12, gap: 4 }}>
          <strong>{event.decision ? decisions[event.decision] : '结果回填'} · {outcomes[event.outcome]}</strong>
          <span className="muted">用户声明 · {new Date(event.createdAt).toLocaleString()}{event.artifactVersion ? ` · v${event.artifactVersion}` : ''}</span>
          {event.reason && <span>{reasons.find(r => r.value === event.reason)?.label ?? event.reason}</span>}
          {event.note && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{event.note}</p>}
          <span>人工耗时：{event.manualMinutes == null ? '未知' : `${event.manualMinutes} 分钟`} · 收入：{event.revenue == null ? '未知' : `${event.revenue} 元`}</span>
        </div>)}
      </CollapsibleSection>
    </>}
  </div>;
}
