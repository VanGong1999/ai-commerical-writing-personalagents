import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerOntology(program: Command): void {
  const onto = program.command("ontology").description("Ontology 注册表 / 对象 / 查询");

  onto
    .command("registry")
    .action(async () => {
      out(await api("GET", "/ontology/registry"));
    });

  onto
    .command("bindings")
    .argument("<format>")
    .action(async (fmt: string) => {
      out(await api("GET", `/ontology/formats/${encodeURIComponent(fmt)}/bindings`));
    });

  onto
    .command("objects")
    .argument("<projectId>")
    .action(async (projectId: string) => {
      out(await api("GET", `/ontology/projects/${projectId}/objects`));
    });

  onto
    .command("links")
    .argument("<projectId>")
    .action(async (projectId: string) => {
      out(await api("GET", `/ontology/projects/${projectId}/links`));
    });

  onto
    .command("actions")
    .argument("<projectId>")
    .action(async (projectId: string) => {
      out(await api("GET", `/ontology/projects/${projectId}/actions`));
    });

  onto
    .command("scenarios")
    .argument("<projectId>")
    .action(async (projectId: string) => {
      out(await api("GET", `/ontology/projects/${projectId}/scenarios`));
    });

  onto
    .command("object")
    .argument("<rid>")
    .action(async (rid: string) => {
      out(await api("GET", `/ontology/objects/${encodeURIComponent(rid)}`));
    });

  onto
    .command("query")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/ontology/query", JSON.parse(opts.body)));
    });

  onto
    .command("submit-action")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/ontology/actions/submit", JSON.parse(opts.body)));
    });

  onto
    .command("import-kb")
    .argument("<projectId>")
    .argument("<docId>")
    .action(async (projectId: string, docId: string) => {
      out(await api("POST", `/ontology/projects/${projectId}/import-kb-graph/${docId}`, {}));
    });
}
