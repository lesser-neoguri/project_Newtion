import type { DbSchema, PropValue } from "@/lib/types";

/* Converts stored BlockNote JSON + database rows into plain text for the chatbot context. */

type Inline = string | { type?: string; text?: string; href?: string; content?: unknown };

function inlineToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => inlineToText(c)).join("");
  const c = content as Inline & { type?: string };
  if (typeof c === "object") {
    if (c.type === "text") return c.text ?? "";
    if (c.type === "link") return inlineToText(c.content);
    if (c.type === "tableCell") return inlineToText(c.content);
    if (c.text) return c.text;
  }
  return "";
}

interface Block {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
}

export function blocksToText(blocks: unknown, depth = 0): string {
  if (!Array.isArray(blocks)) return "";
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  let n = 0;
  for (const raw of blocks as Block[]) {
    const b = raw ?? {};
    const text = inlineToText(b.content);
    if (b.type !== "numberedListItem") n = 0;
    switch (b.type) {
      case "heading":
        out.push(`${"#".repeat(Number(b.props?.level ?? 1))} ${text}`);
        break;
      case "bulletListItem":
      case "toggleListItem":
        out.push(`${pad}- ${text}`);
        break;
      case "numberedListItem":
        out.push(`${pad}${++n}. ${text}`);
        break;
      case "checkListItem":
        out.push(`${pad}[${b.props?.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
        out.push(`> ${text}`);
        break;
      case "codeBlock":
        out.push("```\n" + text + "\n```");
        break;
      case "callout":
        out.push(`${b.props?.emoji ?? "💡"} ${text}`);
        break;
      case "cards": case "timeline": case "pixelCode": case "spriteSheet": case "pixelArt":
      case "curve": case "dropTable": case "recipe": case "spriteGallery":
        // Newtion's custom blocks keep their data as JSON.
        out.push("```newtion-" + b.type + "\n" + String(b.props?.data ?? "{}") + "\n```");
        break;
      case "divider":
        out.push("---");
        break;
      case "table": {
        const rows = (b.content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows ?? [];
        for (const r of rows) out.push("| " + (r.cells ?? []).map((c) => inlineToText(c)).join(" | ") + " |");
        break;
      }
      case "image":
      case "video":
      case "audio":
      case "file":
        out.push(`[${b.type}: ${String(b.props?.name || b.props?.caption || b.props?.url || "")}]`);
        break;
      default:
        if (text) out.push(pad + text);
    }
    if (b.children?.length) out.push(blocksToText(b.children, depth + 1));
  }
  return out.filter((l) => l !== "").join("\n");
}

export function propValueToText(
  schema: DbSchema,
  propId: string,
  value: PropValue | undefined,
  people: Map<string, string>,
): string {
  const prop = schema.properties.find((p) => p.id === propId);
  if (!prop || value == null || value === "") return "";
  const opt = (id: unknown) => prop.options?.find((o) => o.id === id)?.name ?? String(id);
  switch (prop.type) {
    case "select":
    case "status":
      return opt(value);
    case "multi_select":
      return Array.isArray(value) ? value.map(opt).join(", ") : "";
    case "person":
      return people.get(String(value)) ?? "";
    case "checkbox":
      return value ? "예" : "아니오";
    default:
      return String(value);
  }
}
