import type { Artifact } from "@xiezuomanju/domain";

export type CharacterProfile = {
  key: string;
  name: string;
  artifact: Artifact;
  fields: Record<string, unknown>;
  index?: number;
};

export function characterProfiles(artifacts: Artifact[]): CharacterProfile[] {
  return artifacts.flatMap<CharacterProfile>((artifact) => {
    const fields = artifact.bodyJson ?? {};
    if (!Array.isArray(fields.characters)) {
      return [{ key: artifact.id, name: artifact.title, artifact, fields }];
    }
    const rows: unknown[] = fields.characters;
    return rows.flatMap((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const fields = row as Record<string, unknown>;
      const name = fields.name;
      if (typeof name !== "string" || !name.trim()) return [];
      return [{ key: JSON.stringify([artifact.id, index, name]), name, artifact, fields, index }];
    });
  });
}

export function profileRole(profile: CharacterProfile): string {
  const role = profile.fields.role ?? profile.fields.function;
  return typeof role === "string" ? role : "";
}

export const biographyFields = [
  { key: "role", label: "功能位" },
  { key: "gender", label: "性别" },
  { key: "age", label: "年龄" },
  { key: "identity", label: "身份" },
  { key: "appearance", label: "外貌", multiline: true },
  { key: "background_personality", label: "成长经历与性格", multiline: true },
  { key: "motivation_goal", label: "动机与目标", multiline: true },
  { key: "voice", label: "声口", multiline: true },
  { key: "bottom_line", label: "底线", multiline: true },
  { key: "desire", label: "欲望", multiline: true },
  { key: "fear", label: "恐惧", multiline: true },
  { key: "secret", label: "秘密", multiline: true },
  { key: "bodyMarkdown", label: "角色小传正文", multiline: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; multiline?: boolean }>;

export function updateBiographyProfile(profile: CharacterProfile, edits: Record<string, string>) {
  const fields = { ...profile.fields };
  for (const [key, text] of Object.entries(edits)) {
    fields[key] = typeof fields[key] === "number" && text !== "" && Number.isFinite(Number(text))
      ? Number(text)
      : text;
  }
  const body = profile.artifact.bodyJson ?? {};
  const rows = body.characters;
  if (profile.index === undefined || !Array.isArray(rows)) return body;
  const characters = rows.slice();
  characters[profile.index] = fields;
  return { ...body, characters };
}
