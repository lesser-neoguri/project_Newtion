import { blocksToMd } from "@/lib/blocks/md";
import type { BlockNoteEditor } from "@blocknote/core";

/** Part of the document the user selected and "attached" for the AI to edit. */
export interface SelectionAttachment {
  blockIds: string[];
  markdown: string;
  preview: string;
  count: number;
}

/** The blocks covered by the current selection, as an attachment for the AI. Null if nothing is selected. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function selectionToAttachment(editor: BlockNoteEditor<any, any, any>, allowCursor = false): SelectionAttachment | null {
  const sel = editor.getSelection();
  if (!sel?.blocks?.length && !allowCursor) return null;
  const blocks = sel?.blocks?.length ? sel.blocks : [editor.getTextCursorPosition().block];
  const markdown = blocksToMd(editor, blocks);
  if (!markdown.trim()) return null;
  const text = (editor.getSelectedText() || markdown).replace(/\s+/g, " ").trim();
  return {
    blockIds: blocks.map((b) => b.id),
    markdown,
    preview: text.length > 60 ? text.slice(0, 60) + "…" : text,
    count: blocks.length,
  };
}

