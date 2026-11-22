import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSkill } from "./skills.ts";
import { fileURLToPath } from "node:url";

const catalog = JSON.parse(readFileSync(new URL("../skills/catalog.json", import.meta.url), "utf8"));
for (const id of ["duanju/scene/location-budget", "duanju/scene/scene-triple"]) {
  test(id + " treats a continuing goal as contextual advice", () => {
    const source = loadSkill(fileURLToPath(new URL("../skills/" + id + "/SKILL.md", import.meta.url)));
    const entry = catalog.skills.find((row: {id: string}) => row.id === id);
    assert.equal(entry.body, source.body);
    assert.equal(entry.description, source.description);
    assert.doesNotMatch(source.body, /强制同景换|必须换.{0,10}任务|未换任务\/对抗.{0,35}Fail/);
    assert.match(source.body, /病房.{0,50}遗嘱/);
    assert.match(source.body, /作者明确要求/);
  });
}
