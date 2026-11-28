"use client";

import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { createReactBlockSpec, getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from "@blocknote/react";
import { BLOCK_CONFIGS } from "@/lib/blocks/shared";
import { CARDS_DEFAULT, CalloutView, CardsView, RECIPE_DEFAULT, RecipeView, TIMELINE_DEFAULT, TimelineView } from "./content-blocks";
import { PIXELCODE_DEFAULT, PixelCodeView } from "./pixel-code";
import { PIXEL_DEFAULT, PixelArtView, PIXELART_PRESETS, SPRITE_DEFAULT, SpriteSheetView } from "./pixel-blocks";
import { CURVE_DEFAULT, CurveView, DROP_DEFAULT, DropTableView } from "./data-blocks";
import type { AnyEditor } from "./common";

/* eslint-disable @typescript-eslint/no-explicit-any */
const callout = createReactBlockSpec(BLOCK_CONFIGS.callout as any, {
  render: ({ block, editor, contentRef }: any) => <CalloutView block={block} editor={editor} contentRef={contentRef} />,
});
const plain = (key: Exclude<keyof typeof BLOCK_CONFIGS, "callout">, View: React.ComponentType<{ block: any; editor: any }>) =>
  createReactBlockSpec(BLOCK_CONFIGS[key] as any, { render: ({ block, editor }: any) => <View block={block} editor={editor} /> });

export const newtionSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: callout(),
    cards: plain("cards", CardsView)(),
    timeline: plain("timeline", TimelineView)(),
    pixelCode: plain("pixelCode", PixelCodeView)(),
    spriteSheet: plain("spriteSheet", SpriteSheetView)(),
    pixelArt: plain("pixelArt", PixelArtView)(),
    curve: plain("curve", CurveView)(),
    dropTable: plain("dropTable", DropTableView)(),
    recipe: plain("recipe", RecipeView)(),
  } as any,
});

const GROUP = "게임 개발";

const STARTERS: Record<string, object> = {
  cards: CARDS_DEFAULT, timeline: TIMELINE_DEFAULT, pixelCode: PIXELCODE_DEFAULT, spriteSheet: SPRITE_DEFAULT,
  pixelArt: PIXEL_DEFAULT, curve: CURVE_DEFAULT, dropTable: DROP_DEFAULT, recipe: RECIPE_DEFAULT,
};

function customItems(editor: AnyEditor): DefaultReactSuggestionItem[] {
  // New blocks start with their sample data saved, so AI tools (MCP, tidy) see what's on screen.
  const add = (type: string, props: Record<string, string> = {}) => () => {
    const starter = STARTERS[type];
    insertOrUpdateBlockForSlashMenu(editor, { type, props: starter && !props.data ? { data: JSON.stringify(starter), ...props } : props } as any);
  };
  const item = (title: string, subtext: string, icon: string, aliases: string[], run: () => void, group = GROUP) => ({
    title, subtext, aliases, group, onItemClick: run,
    icon: <span className="text-base leading-none">{icon}</span>,
  });
  return [
    item("콜아웃", "강조 상자 (아이콘·색)", "💡", ["callout", "강조", "박스", "note", "팁"], add("callout"), "기본 블록"),
    item("가로 스크롤 카드", "옆으로 넘기는 카드 묶음 (아이템·바이옴·NPC)", "🃏", ["cards", "carousel", "가로", "스크롤", "갤러리"], add("cards")),
    item("연대표", "세계관 역사·개발 일정 타임라인", "🕰️", ["timeline", "타임라인", "연표", "역사", "일정"], add("timeline")),
    item("픽셀 코드", "JS로 픽셀을 그리고 움직이는 놀이터", "👾", ["pixel", "code", "canvas", "코드", "프로토타입", "놀이터"], add("pixelCode")),
    item("스프라이트 · 이펙트", "스프라이트 시트를 잘라서 애니메이션 재생", "✨", ["sprite", "effect", "애니메이션", "이펙트", "시트"], add("spriteSheet")),
    item("픽셀 아트 · 배치도", "도트 그리기 / 이동 성채 모듈 배치도", "🧱", ["pixel art", "tile", "도트", "타일", "배치도", "성채", "모듈"], add("pixelArt")),
    item("빈 16×16 스프라이트", "도트 캔버스부터 시작", "🎨", ["sprite", "도트", "16"], add("pixelArt", { data: JSON.stringify(PIXELART_PRESETS.sprite.data) })),
    item("밸런스 곡선", "수식으로 레벨별 수치 그래프", "📈", ["curve", "graph", "balance", "그래프", "밸런스", "수식", "경험치"], add("curve")),
    item("드롭 테이블", "가중치 확률표 + 시뮬레이션", "🎲", ["drop", "loot", "확률", "드롭", "가챠", "전리품"], add("dropTable")),
    item("제작 레시피", "재료 → 결과물 조합표", "⚒️", ["recipe", "craft", "제작", "조합", "레시피"], add("recipe")),
  ];
}

export async function slashItems(editor: AnyEditor, query: string) {
  const defaults = getDefaultReactSlashMenuItems(editor);
  const [callout, ...game] = customItems(editor);
  // Groups must stay contiguous: put the callout right after the last basic block.
  const basic = (defaults.find((i) => (i as { key?: string }).key === "paragraph") ?? defaults[0])?.group;
  callout.group = basic;
  let at = -1;
  defaults.forEach((i, k) => { if (i.group === basic) at = k; });
  const all = [...defaults.slice(0, at + 1), callout, ...defaults.slice(at + 1), ...game];
  return filterSuggestionItems(all, query);
}
