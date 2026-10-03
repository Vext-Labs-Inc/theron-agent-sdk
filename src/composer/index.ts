export type Sigil = "/" | "@";

export interface ComposerToken {
  sigil: Sigil;
  /** text after the sigil, up to the cursor — e.g. "fact" from "/fact" */
  query: string;
  /** index of the sigil in the full text */
  start: number;
  /** cursor index (end of the token span) */
  end: number;
}

/**
 * Find the active sigil-token under the cursor.
 * The sigil must be at the start of the text or preceded by whitespace
 * (so "http://x" and "and/or" do not open the palette), and the query may
 * not contain whitespace. Returns the closest token to the cursor, or null.
 */
export function findToken(text: string, cursor: number, sigils: Sigil[] = ["/", "@"]): ComposerToken | null {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  let best: ComposerToken | null = null;
  for (const sigil of sigils) {
    const idx = before.lastIndexOf(sigil);
    if (idx === -1) continue;
    if (idx !== 0 && !/\s/.test(text[idx - 1])) continue;
    const query = before.slice(idx + 1);
    if (/\s/.test(query)) continue;
    if (!best || idx > best.start) best = { sigil, query, start: idx, end: before.length };
  }
  return best;
}

/**
 * Replace a token span with a chosen value, preserving the surrounding text,
 * and return the new text plus cursor position.
 */
export function replaceToken(
  text: string,
  token: ComposerToken,
  value: string,
  trailing = " ",
): { text: string; cursor: number } {
  const inserted = token.sigil + value + trailing;
  const next = text.slice(0, token.start) + inserted + text.slice(token.end);
  return { text: next, cursor: token.start + inserted.length };
}

/**
 * Insert a sigil at the cursor without replacing existing input. Adds a
 * leading space when needed so the sigil starts a fresh token mid-message.
 */
export function insertSigil(text: string, cursor: number, sigil: Sigil): { text: string; cursor: number } {
  const pos = Math.max(0, Math.min(cursor, text.length));
  const needsSpace = pos > 0 && !/\s/.test(text[pos - 1]);
  const ins = (needsSpace ? " " : "") + sigil;
  const next = text.slice(0, pos) + ins + text.slice(pos);
  return { text: next, cursor: pos + ins.length };
}

export interface PaletteItem {
  name: string;
  description?: string;
  [k: string]: unknown;
}

/**
 * Rank palette items for a query: exact > name-prefix > word-prefix > substring >
 * description-substring. Stable, case-insensitive. Empty query keeps order.
 */
export function filterPalette<T extends PaletteItem>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice();
  const scored: Array<{ item: T; score: number; i: number }> = [];
  items.forEach((item, i) => {
    const name = String(item.name || "").toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(/[\s\-_]/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    else if (String(item.description || "").toLowerCase().includes(q)) score = 4;
    if (score >= 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.map((s) => s.item);
}

/** One pill model for @-context chips and /-skill chips. */
export interface ComposerPill {
  kind: "ctx" | "skill";
  token: string;
  label: string;
  sourcePath?: string;
}

export interface SkillLike {
  name: string;
  body: string;
  allowedTools?: string[];
}

export interface SkillRewrite {
  /** prompt with every known /skill token replaced by its body inline */
  text: string;
  /** pills for the skills that were applied (in order) */
  pills: ComposerPill[];
  /** names of the skills that were injected */
  injected: string[];
}

/**
 * Find every /skill token in a prompt — leading or mid-message — replace each with
 * the skill body, and return the rewritten text plus pill descriptors.
 * Unknown /tokens are left untouched.
 */
export function rewriteSkills(prompt: string, skills: SkillLike[]): SkillRewrite {
  const byName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const pills: ComposerPill[] = [];
  const injected: string[] = [];
  const re = /(^|\s)\/([A-Za-z0-9][\w-]*)/g;
  const text = prompt.replace(re, (whole, pre, name) => {
    const skill = byName.get(name.toLowerCase());
    if (!skill) return whole;
    const toolNote =
      skill.allowedTools && skill.allowedTools.length > 0
        ? `\n\n(Prefer these tools: ${skill.allowedTools.join(", ")})`
        : "";
    const body = (skill.body + toolNote).trim();
    if (!body) return whole;
    pills.push({ kind: "skill", token: name, label: name });
    injected.push(name);
    return pre + body;
  });
  return { text, pills, injected };
}

/** Slash commands that destroy state (chat reset) and must confirm first. */
export const DESTRUCTIVE_SLASH = new Set(["clear", "new", "reset"]);

export function isDestructive(name: string): boolean {
  return DESTRUCTIVE_SLASH.has(String(name || "").replace(/^\//, "").toLowerCase());
}
