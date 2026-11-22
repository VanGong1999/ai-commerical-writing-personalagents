import type { CoreHookBody, GateCheck } from "./entities";
import { checkCoreHookAdoption as checkAdoption, FRONTEND_CORE_HOOK_PROFILE } from "./gateRules.ts";

export { checkLengthDecay, manuscriptLength, codepointCount, hasJsonContent, allPassed, canStrongAdopt, checkEpisodeHook, checkPromptLock, checkPromptLockHash, simpleHash } from "./gateRules.ts";

/** Preserve the UI's stricter adoption requirements through an explicit profile. */
export function checkCoreHookAdoption(hook: CoreHookBody, mode: "draft" | "strong"): GateCheck[] {
  return checkAdoption(hook, mode, FRONTEND_CORE_HOOK_PROFILE);
}
