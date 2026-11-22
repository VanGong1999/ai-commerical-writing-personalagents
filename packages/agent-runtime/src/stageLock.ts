/** @deprecated 逻辑已并入 stages.ts，此处再导出以兼容旧 import */
export {
  ackStage,
  advanceStage,
  canJumpTo,
  createInitialLockState,
  exportStageGraph,
  getStageNode,
  isStageLocked,
  type StageAdvanceResult,
  type StageLockState,
} from "./stages.ts";
