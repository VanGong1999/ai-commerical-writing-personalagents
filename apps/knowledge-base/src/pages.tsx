import { Button, PageHeader, Panel } from "@xiezuomanju/ui";
import { writingAppBase } from "./appBase";

export function KbShellHome() {
  const base = writingAppBase();
  return (
    <div className="page">
      <PageHeader
        title="知识库独立入口"
        description="完整文档 / 图谱 / 桥段 / 热点页面由 ai-writing 承载，本应用为薄壳跳转。"
      />
      <Panel title="快捷入口">
        <div className="stack">
          <a href={`${base}/kb`}>
            <Button variant="primary">文档列表</Button>
          </a>
          <a href={`${base}/kb/tropes`}>
            <Button>桥段库</Button>
          </a>
          <a href={`${base}/kb/hotspots`}>
            <Button>热点</Button>
          </a>
        </div>
      </Panel>
    </div>
  );
}
