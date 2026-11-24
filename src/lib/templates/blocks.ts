// Tiny helpers to author BlockNote content (PartialBlock[]) for templates.
type Block = Record<string, unknown>;

export const h1 = (text: string): Block => ({ type: "heading", props: { level: 1 }, content: text });
export const h2 = (text: string): Block => ({ type: "heading", props: { level: 2 }, content: text });
export const h3 = (text: string): Block => ({ type: "heading", props: { level: 3 }, content: text });
export const p = (text = ""): Block => ({ type: "paragraph", content: text });
export const quote = (text: string): Block => ({ type: "quote", content: text });
export const bullet = (text: string, children: Block[] = []): Block => ({
  type: "bulletListItem",
  content: text,
  children,
});
export const num = (text: string): Block => ({ type: "numberedListItem", content: text });
export const todo = (text: string, checked = false): Block => ({
  type: "checkListItem",
  props: { checked },
  content: text,
});
export const toggle = (text: string, children: Block[]): Block => ({
  type: "toggleListItem",
  content: text,
  children,
});
export const divider = (): Block => ({ type: "divider" });
export const code = (text: string, language = "text"): Block => ({
  type: "codeBlock",
  props: { language },
  content: text,
});
export const callout = (emoji: string, text: string): Block => quote(`${emoji} ${text}`);
export const table = (rows: string[][]): Block => ({
  type: "table",
  content: {
    type: "tableContent",
    rows: rows.map((cells) => ({ cells })),
  },
});
