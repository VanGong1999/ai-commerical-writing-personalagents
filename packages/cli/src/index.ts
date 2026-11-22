#!/usr/bin/env node
import { Command } from "commander";
import { initConfig } from "./config.js";
import { err } from "./format.js";
import { registerAgents } from "./commands/agents.js";
import { registerArtifacts } from "./commands/artifacts.js";
import { registerAssistant } from "./commands/assistant.js";
import { registerBots } from "./commands/bots.js";
import { registerChat } from "./commands/chat.js";
import { registerConvs } from "./commands/convs.js";
import { registerExport } from "./commands/export.js";
import { registerHealth } from "./commands/health.js";
import { registerJobs } from "./commands/jobs.js";
import { registerKb } from "./commands/kb.js";
import { registerMemory } from "./commands/memory.js";
import { registerOntology } from "./commands/ontology.js";
import { registerProjects } from "./commands/projects.js";
import { registerPrompts } from "./commands/prompts.js";
import { registerProviders } from "./commands/providers.js";
import { registerProposals, registerSchedule } from "./commands/schedule.js";
import { registerRun } from "./commands/run.js";
import { registerRuns } from "./commands/runs.js";
import { registerSettings } from "./commands/settings.js";
import { registerStack } from "./commands/stack.js";
import { registerTasks } from "./commands/tasks.js";
import { registerUsage } from "./commands/usage.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("xzm")
    .description("AI 商业写作台本地 CLI")
    .version("0.1.0")
    .option("--api-base <url>", "API 根地址，默认 http://127.0.0.1:8000")
    .option("--json", "JSON 输出")
    .option("-q, --quiet", "减少人读输出")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.optsWithGlobals() as {
        apiBase?: string;
        json?: boolean;
        quiet?: boolean;
      };
      initConfig({
        apiBase: opts.apiBase,
        json: opts.json,
        quiet: opts.quiet,
      });
    });

  registerStack(program);
  registerHealth(program);
  registerProjects(program);
  registerArtifacts(program);
  registerAgents(program);
  registerRun(program);
  registerRuns(program);
  registerJobs(program);
  registerTasks(program);
  registerKb(program);
  registerExport(program);
  registerProviders(program);
  registerSettings(program);
  registerChat(program);
  registerConvs(program);
  registerAssistant(program);
  registerMemory(program);
  registerBots(program);
  registerUsage(program);
  registerPrompts(program);
  registerSchedule(program);
  registerProposals(program);
  registerOntology(program);

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  err(String((e as Error)?.stack || (e as Error)?.message || e));
  process.exitCode = 1;
});
