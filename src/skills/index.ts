// On-disk SKILL.md loader.
//
// Mirrors Claude Code's `.claude/skills/<name>/SKILL.md` and the SDK's own
// `.theron/agents/*.md` agent loader: a skill is a Markdown file with YAML
// frontmatter (name, description, optional allowed-tools + model) whose body is
// the instruction pack injected when the skill is invoked.
//
// Both the CLI and the editor ship a set of built-in skills in
// code; this loader lets users/teams add their OWN skills by dropping files in
// `~/.theron/skills/*.md` (global) or `<project>/.theron/skills/*.md`
// (project-local, takes precedence). File-defined skills override built-ins of
// the same name, so the set is hot-editable without a rebuild.

export interface MarkdownSkill {
  /** Slug used to invoke the skill (/<name>). Lowercased, kebab. */
  name: string;
  /** One-line summary the model uses to decide relevance. */
  description: string;
  /** The instruction pack — the Markdown body after the frontmatter. */
  body: string;
  /** Optional tool allowlist surfaced while the skill is active. */
  allowedTools?: string[];
  /** Optional per-skill model override. */
  model?: string;
  /** Source file path (for diagnostics / "where did this come from"). */
  source: string;
}

/** Parse one SKILL.md file. Returns null if it lacks frontmatter or a body. */
export function parseMarkdownSkill(filename: string, content: string): MarkdownSkill | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();
  if (!body) return null;

  // Minimal YAML: flat `key: value` plus `- item` lists (same shape as the
  // agent loader — no full YAML dependency for the SDK).
  const fields: Record<string, unknown> = {};
  let currentKey = "";
  for (const line of frontmatter.split("\n")) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      const existing = fields[currentKey];
      if (Array.isArray(existing)) existing.push(listMatch[1].trim());
      else fields[currentKey] = [listMatch[1].trim()];
      continue;
    }
    const kvMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      fields[currentKey] = kvMatch[2].trim().replace(/^["']|["']$/g, "");
    }
  }

  const rawName = String(fields.name || filename.replace(/\.md$/i, "")).trim();
  const name = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
  if (!name) return null;

  // allowed-tools may be a YAML list OR a comma-separated string.
  let allowedTools: string[] | undefined;
  const at = fields["allowed-tools"] ?? fields.allowedTools ?? fields.tools;
  if (Array.isArray(at)) allowedTools = at.map(String);
  else if (typeof at === "string" && at.trim()) {
    allowedTools = at.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return {
    name,
    description: String(fields.description || ""),
    body,
    allowedTools,
    model: fields.model ? String(fields.model) : undefined,
    source: filename,
  };
}

/** Load all SKILL.md files from a directory. Never throws. */
export async function loadMarkdownSkills(dir: string): Promise<MarkdownSkill[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const out: MarkdownSkill[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      try {
        if (ent.isFile() && ent.name.endsWith(".md")) {
          const full = path.join(dir, ent.name);
          const parsed = parseMarkdownSkill(ent.name, await fs.readFile(full, "utf8"));
          if (parsed) out.push(parsed);
        } else if (ent.isDirectory()) {
          // Claude-Code-style `<name>/SKILL.md` layout.
          const full = path.join(dir, ent.name, "SKILL.md");
          const buf = await fs.readFile(full, "utf8").catch(() => null);
          if (buf) {
            const parsed = parseMarkdownSkill(`${ent.name}/SKILL.md`, buf);
            if (parsed) out.push({ ...parsed, name: parsed.name || ent.name.toLowerCase() });
          }
        }
      } catch {
        /* skip unreadable entry */
      }
    }
  } catch {
    /* dir missing — fine */
  }
  return out;
}

/**
 * Load skills from both global (~/.theron/skills) and project-local
 * (<project>/.theron/skills) directories. Project-local wins on name
 * collisions. Never throws.
 */
export async function loadAllMarkdownSkills(projectDir?: string): Promise<MarkdownSkill[]> {
  const os = await import("node:os");
  const path = await import("node:path");
  const globalDir = path.join(os.homedir(), ".theron", "skills");
  const localDir = path.join(projectDir ?? process.cwd(), ".theron", "skills");

  const [globalSkills, localSkills] = await Promise.all([
    loadMarkdownSkills(globalDir),
    loadMarkdownSkills(localDir),
  ]);

  const byName = new Map<string, MarkdownSkill>();
  for (const s of globalSkills) byName.set(s.name, s);
  for (const s of localSkills) byName.set(s.name, s);
  return [...byName.values()];
}
