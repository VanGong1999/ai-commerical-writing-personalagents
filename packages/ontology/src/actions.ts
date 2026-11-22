import { ACTION_TYPES } from "./catalog.ts";
import { contentHash } from "./hash.ts";
import { makeRid } from "./rid.ts";

export type ActionCriteriaResult = {
  id: string;
  name: string;
  result: "pass" | "fail" | "warn" | "inconclusive";
  message: string;
};

export type ActionRequest = {
  actionApiName: string;
  projectId: string;
  actor: string;
  parameters: Record<string, unknown>;
  jobId?: string;
  expectedHash?: string;
};

export type ObjectEdit = {
  op: "create" | "update" | "delete";
  rid?: string;
  typeApiName?: string;
  properties?: Record<string, unknown>;
  previousHash?: string;
};

export type ActionResult = {
  ok: boolean;
  runRid: string;
  actionApiName: string;
  criteria: ActionCriteriaResult[];
  edits: ObjectEdit[];
  sideEffects: Record<string, unknown>;
  error?: string;
  startedAt: string;
  finishedAt: string;
};

export function listActionTypes(format?: string) {
  if (!format) return ACTION_TYPES;
  return ACTION_TYPES.filter((a) => !a.formats?.length || a.formats.includes(format));
}

export function getActionType(apiName: string) {
  return ACTION_TYPES.find((a) => a.apiName === apiName) || null;
}

/** 纯函数：根据 Action 名与参数生成编辑计划（API runtime 负责落库） */
export function planAction(req: ActionRequest): ActionResult {
  const startedAt = new Date().toISOString();
  const runRid = makeRid("ActionRun");
  const def = getActionType(req.actionApiName);
  if (!def) {
    return {
      ok: false,
      runRid,
      actionApiName: req.actionApiName,
      criteria: [
        {
          id: "unknown_action",
          name: "未知 Action",
          result: "fail",
          message: `未注册 Action：${req.actionApiName}`,
        },
      ],
      edits: [],
      sideEffects: {},
      error: "unknown_action",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const criteria: ActionCriteriaResult[] = [];
  const edits: ObjectEdit[] = [];
  const sideEffects: Record<string, unknown> = { materialize: def.materializes || [] };
  const p = req.parameters;

  switch (req.actionApiName) {
    case "AdoptObject": {
      const rid = String(p.rid || "");
      const mode = String(p.mode || "strong");
      if (!rid) {
        criteria.push({
          id: "param_rid",
          name: "rid",
          result: "fail",
          message: "缺少 rid",
        });
      } else {
        criteria.push({
          id: "param_rid",
          name: "rid",
          result: "pass",
          message: rid,
        });
        edits.push({
          op: "update",
          rid,
          properties: {
            status: mode === "strong" ? "adopted" : "draft",
            adoptedAt: new Date().toISOString(),
            adoptMode: mode,
          },
          previousHash: req.expectedHash || (p.expectedHash as string | undefined),
        });
      }
      break;
    }
    case "UpsertStoryGraph": {
      const props = (p.graph || p.properties || {}) as Record<string, unknown>;
      const rid = String(p.rid || makeRid("StoryGraph"));
      edits.push({
        op: p.rid ? "update" : "create",
        rid,
        typeApiName: "StoryGraph",
        properties: { ...props, kind: "story_graph" },
        previousHash: req.expectedHash,
      });
      sideEffects.regenerateMermaid = true;
      sideEffects.materializeBible = true;
      break;
    }
    case "MergeEpisodeGraph": {
      edits.push({
        op: "update",
        rid: String(p.storyRid || ""),
        typeApiName: "StoryGraph",
        properties: { mergeFrom: p.episodeRid },
        previousHash: req.expectedHash,
      });
      break;
    }
    case "UpsertForeshadow": {
      const rid = String(p.rid || makeRid("ForeshadowEntry"));
      edits.push({
        op: p.rid ? "update" : "create",
        rid,
        typeApiName: "ForeshadowEntry",
        properties: (p.entry || p.properties || {}) as Record<string, unknown>,
      });
      break;
    }
    case "LogicAck": {
      sideEffects.logicAck = {
        projectId: req.projectId,
        note: p.note || "",
        at: new Date().toISOString(),
      };
      criteria.push({
        id: "LogicAck",
        name: "逻辑终审",
        result: "pass",
        message: "人工 LogicAck 已记录（永不由模型自动绿）",
      });
      break;
    }
    case "AckStage": {
      sideEffects.ackStage = { stage: p.stage, projectId: req.projectId };
      break;
    }
    case "AdvanceStage": {
      sideEffects.advanceStage = { to: p.to, force: Boolean(p.force) };
      break;
    }
    case "ForceJump": {
      sideEffects.forceJump = { to: p.to, reason: p.reason || "" };
      break;
    }
    case "LinkExpectationToGraph": {
      const fromRid = String(p.fromRid || "");
      const toRid = String(p.toRid || "");
      const linkType = String(p.linkType || "payoff");
      sideEffects.createLink = { fromRid, toRid, linkType, properties: p.linkProperties || {} };
      break;
    }
    case "CreateScenario": {
      sideEffects.createScenario = {
        label: p.label || "分支",
        baseRids: p.baseRids || [],
      };
      break;
    }
    case "UpdateScenario": {
      sideEffects.updateScenario = {scenarioRid: p.scenarioRid, forkedProperties: p.forkedProperties, expectedBranchHash: p.expectedBranchHash};
      break;
    }
    case "MergeScenario": {
      sideEffects.mergeScenario = { scenarioRid: p.scenarioRid };
      criteria.push({
        id: "HumanConfirm",
        name: "人工确认合并",
        result: p.confirmed === true ? "pass" : "fail",
        message: p.confirmed === true ? "已确认" : "需要 confirmed=true",
      });
      break;
    }
    case "MarkPayoffPaid": {
      edits.push({
        op: "update",
        rid: String(p.rid || ""),
        properties: { status: "paid", payoffEp: p.payoffEp, payoffAt: new Date().toISOString() },
      });
      break;
    }
    case "ProposeObjectEdits": {
      sideEffects.proposalOnly = true;
      sideEffects.proposedEdits = p.edits || [];
      criteria.push({
        id: "proposal",
        name: "仅提案",
        result: "pass",
        message: "未落库；须调用具体写 Action",
      });
      break;
    }
    case "UpsertObject": {
      const typeApiName = String(p.typeApiName || "");
      if (!typeApiName) {
        criteria.push({
          id: "typeApiName",
          name: "typeApiName",
          result: "fail",
          message: "缺少 typeApiName",
        });
        break;
      }
      const rid = String(p.rid || makeRid(typeApiName));
      edits.push({
        op: p.rid ? "update" : "create",
        rid,
        typeApiName,
        properties: (p.properties || p.bodyJson || {}) as Record<string, unknown>,
        previousHash: req.expectedHash,
      });
      sideEffects.materialize = true;
      break;
    }
    default: {
      // 通用：若带 properties + typeApiName 则 upsert
      if (p.typeApiName && (p.properties || p.bodyJson)) {
        const rid = String(p.rid || makeRid(String(p.typeApiName)));
        edits.push({
          op: p.rid ? "update" : "create",
          rid,
          typeApiName: String(p.typeApiName),
          properties: (p.properties || p.bodyJson || {}) as Record<string, unknown>,
          previousHash: req.expectedHash,
        });
      }
      sideEffects.accepted = true;
      break;
    }
  }

  const failed = criteria.some((c) => c.result === "fail" || c.result === "inconclusive");
  return {
    ok: !failed,
    runRid,
    actionApiName: req.actionApiName,
    criteria,
    edits,
    sideEffects: {
      ...sideEffects,
      parameterHash: contentHash(req.parameters),
    },
    error: failed ? "criteria_failed" : undefined,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
