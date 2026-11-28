/**
 * Newtion's custom editor blocks — config shared by the browser editor and the MCP server.
 *
 * Every custom block keeps its data in one JSON string prop (`data`), except the callout
 * (inline rich text + emoji/color). For Markdown (AI tidy, MCP read/edit, version diffs) each
 * custom block becomes a fenced code block:
 *
 *   ```newtion-timeline
 *   { "events": [ ... ] }
 *   ```
 *
 * so AI tools can read them, edit them, and even write new ones, and nothing gets dropped.
 */

export const CUSTOM_BLOCK_TYPES = [
  "callout", "cards", "timeline", "pixelCode", "spriteSheet", "pixelArt", "curve", "dropTable", "recipe", "spriteGallery",
] as const;
export type CustomBlockType = (typeof CUSTOM_BLOCK_TYPES)[number];

export const BLOCK_CONFIGS = {
  callout: {
    type: "callout",
    propSchema: { emoji: { default: "💡" }, color: { default: "gray" } },
    content: "inline",
  },
  cards: { type: "cards", propSchema: { data: { default: "" } }, content: "none" },
  timeline: { type: "timeline", propSchema: { data: { default: "" } }, content: "none" },
  pixelCode: { type: "pixelCode", propSchema: { data: { default: "" } }, content: "none" },
  spriteSheet: { type: "spriteSheet", propSchema: { data: { default: "" } }, content: "none" },
  pixelArt: { type: "pixelArt", propSchema: { data: { default: "" } }, content: "none" },
  curve: { type: "curve", propSchema: { data: { default: "" } }, content: "none" },
  dropTable: { type: "dropTable", propSchema: { data: { default: "" } }, content: "none" },
  recipe: { type: "recipe", propSchema: { data: { default: "" } }, content: "none" },
  spriteGallery: { type: "spriteGallery", propSchema: { data: { default: "" } }, content: "none" },
} as const;

/** What each block is, for AI tools reading the fenced JSON. */
export const BLOCK_HELP: Record<CustomBlockType, string> = {
  callout: '강조 박스. {"emoji":"💡","color":"gray|blue|green|yellow|orange|red|purple","text":"..."}',
  cards: '가로 스크롤 카드. {"width":220,"pixel":false,"cards":[{"title":"","tag":"","text":"","image":"url"}]}',
  timeline: '연대표. {"mode":"vertical|horizontal","events":[{"date":"","title":"","text":"","color":"#hex"}]}',
  pixelCode: '픽셀 코드 놀이터(JS). {"w":64,"h":48,"scale":6,"fps":30,"code":"function update(dt){} function draw(){ clear(0); px(x,y,7) }"}',
  spriteSheet: '스프라이트 시트 애니메이션. {"url":"","fw":32,"fh":32,"frames":0,"fps":12,"scale":4,"bg":"checker|dark|light","trail":false}',
  pixelArt: '픽셀 아트/타일 배치도. {"w":16,"h":16,"cell":16,"palette":[{"c":"#hex","name":"이름"}],"px":"행 우선 문자열: . = 빈칸, 0-9a-z = 팔레트 번호"}',
  curve: '밸런스 곡선. {"from":1,"to":50,"step":1,"xLabel":"레벨","series":[{"name":"","expr":"10*1.15^x","color":"#hex"}]}',
  dropTable: '드롭 테이블. {"rolls":1,"rows":[{"name":"","weight":10,"min":1,"max":1,"rarity":"common|uncommon|rare|epic|legendary"}]}',
  spriteGallery: '스프라이트 도감(모듈별 GIF). {"layout":"list|grid","size":112,"bg":"dark|checker|light","items":[{"name":"","tag":"분류","tier":"시작|초반|중반|후반|유물","desc":"한 줄 설명","stats":[{"k":"무게","v":"28t"}],"lore":"배경 설정","tip":"운영 팁","note":"","gif":"GIF url","w":0,"h":0}]}',
  recipe: '제작 레시피. {"recipes":[{"station":"","inputs":[{"name":"","qty":1}],"output":{"name":"","qty":1},"time":""}]}',
};

const FENCE = "newtion-";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const isCustom = (t: string): t is CustomBlockType => (CUSTOM_BLOCK_TYPES as readonly string[]).includes(t);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inlineText(content: any): string {
  return Array.isArray(content)
    ? content.map((c) => (c.type === "text" ? c.text : c.type === "link" ? inlineText(c.content) : "")).join("")
    : "";
}

export function parseData<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return { ...fallback, ...JSON.parse(raw) }; } catch { return fallback; }
}

/** Custom blocks → fenced code blocks (recursively), for Markdown export. */
export function toMdBlocks(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    const children = b.children?.length ? toMdBlocks(b.children) : b.children;
    if (!isCustom(b.type)) return children === b.children ? b : { ...b, children };
    let json: unknown;
    if (b.type === "callout") json = { emoji: b.props?.emoji, color: b.props?.color, text: inlineText(b.content) };
    else { try { json = JSON.parse(b.props?.data || "{}"); } catch { json = {}; } }
    return {
      id: b.id,
      type: "codeBlock",
      props: { language: FENCE + b.type },
      content: [{ type: "text", text: JSON.stringify(json, null, 2), styles: {} }],
      children: children ?? [],
    };
  });
}

/** Fenced `newtion-*` code blocks → custom blocks (recursively), after Markdown import. */
export function fromMdBlocks(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    const children = b.children?.length ? fromMdBlocks(b.children) : b.children;
    const lang: string = b.type === "codeBlock" ? b.props?.language ?? "" : "";
    const type = lang.startsWith(FENCE) ? lang.slice(FENCE.length) : "";
    if (!isCustom(type)) return children === b.children ? b : { ...b, children };
    let json: Record<string, unknown>;
    try { json = JSON.parse(inlineText(b.content)); } catch { return b; }
    if (type === "callout") {
      return {
        type: "callout",
        props: { emoji: String(json.emoji ?? "💡"), color: String(json.color ?? "gray") },
        content: String(json.text ?? ""),
        children: children ?? [],
      };
    }
    return { type, props: { data: JSON.stringify(json) }, children: children ?? [] };
  });
}
