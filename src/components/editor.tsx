"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  FormattingToolbar,
  FormattingToolbarController,
  MobileFormattingToolbarController,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
} from "@blocknote/react";
import { Sparkles } from "lucide-react";
import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration } from "@blocknote/core/yjs";
import { ko } from "@blocknote/core/locales";
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseYProvider, fromB64, toB64 } from "@/lib/yjs-supabase";
import { uploadFile } from "@/lib/api";
import { selectionToAttachment, type SelectionAttachment } from "@/lib/selection";
import type { Profile } from "@/lib/types";

interface Props {
  sb: SupabaseClient;
  pageId: string;
  workspaceId: string;
  initialYdoc: string | null;
  initialContent: unknown[];
  me: Profile;
  editable: boolean;
  onSaveState?: (s: "saving" | "saved" | "error") => void;
  /** Receives the editor instance once mounted (null on unmount). */
  onEditor?: (editor: BlockNoteEditor | null) => void;
  /** Called when the user sends the current selection to the AI. */
  onAskAI?: (attachment: SelectionAttachment) => void;
}

/** True on phones/tablets (touch as the main input). */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const fn = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return coarse;
}

/** Toolbar button: attach the selected blocks to the AI bar. */
function AskAIButton({ onAsk }: { onAsk: (a: SelectionAttachment) => void }) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  if (!Components) return null;
  return (
    <Components.FormattingToolbar.Button
      mainTooltip="선택한 부분을 AI에게 보내기"
      label="AI에게"
      onClick={() => {
        const a = selectionToAttachment(editor as unknown as BlockNoteEditor, true);
        if (a) onAsk(a);
      }}
    >
      <span className="flex items-center gap-1 px-0.5 text-[13px] font-medium">
        <Sparkles size={14} /> AI
      </span>
    </Components.FormattingToolbar.Button>
  );
}

export type { BlockNoteEditor };
export type { SelectionAttachment } from "@/lib/selection";

/** Sets up the Y.Doc + realtime provider for a page, then renders the editor. */
export default function CollaborativeEditor(props: Props) {
  const [session, setSession] = useState<{ doc: Y.Doc; provider: SupabaseYProvider } | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    if (props.initialYdoc) {
      try {
        Y.applyUpdate(doc, fromB64(props.initialYdoc));
      } catch (e) {
        console.error("Failed to load stored ydoc", e);
      }
    }
    const provider = new SupabaseYProvider(props.sb, props.pageId, doc);
    setSession({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
      setSession(null);
    };
    // Re-create only when switching pages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pageId]);

  if (!session) return null;
  return <EditorInner key={props.pageId} {...props} doc={session.doc} provider={session.provider} />;
}

/** True when a document has no blocks, or only empty paragraphs. */
function isEmptyDoc(blocks: unknown[] | null | undefined) {
  if (!blocks?.length) return true;
  return blocks.every((b) => {
    const blk = b as { type?: string; content?: unknown; children?: unknown[] };
    const noText =
      blk.content == null ||
      blk.content === "" ||
      (Array.isArray(blk.content) && blk.content.length === 0);
    return blk.type === "paragraph" && noText && !blk.children?.length;
  });
}

function useColorScheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return dark ? "dark" : "light";
}

function EditorInner({
  sb, pageId, workspaceId, initialContent, me, editable, onSaveState, onEditor, onAskAI, doc, provider,
}: Props & { doc: Y.Doc; provider: SupabaseYProvider }) {
  const theme = useColorScheme();
  const coarse = useCoarsePointer();
  const fragment = doc.getXmlFragment("document-store");

  const editor = useCreateBlockNote(
    withCollaboration({
      dictionary: {
        ...ko,
        placeholders: { ...ko.placeholders, emptyDocument: "'/'를 입력해 명령어 사용", default: "'/'를 입력해 명령어 사용" },
      },
      uploadFile: (file: File) => uploadFile(sb, workspaceId, file),
      collaboration: {
        fragment,
        provider,
        user: { name: me.display_name || me.email, color: me.avatar_color },
        showCursorLabels: "activity",
      },
    }),
    [doc, provider],
  );

  useEffect(() => {
    onEditor?.(editor as unknown as BlockNoteEditor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // Seed a page that has JSON content (e.g. from a template) but an empty Yjs doc.
  // y-prosemirror creates one empty paragraph on mount, so check for "empty", not length 0.
  useEffect(() => {
    if (!editable || isEmptyDoc(initialContent)) return;
    provider.onSynced(() => {
      if (isEmptyDoc(editor.document)) {
        editor.replaceBlocks(editor.document, initialContent as PartialBlock[]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Persist: debounce local changes into pages.ydoc + pages.content
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (!editable) return;

    const save = async () => {
      if (!dirty.current) return;
      dirty.current = false;
      onSaveState?.("saving");
      const { error } = await sb
        .from("pages")
        .update({ ydoc: toB64(Y.encodeStateAsUpdate(doc)), content: editor.document })
        .eq("id", pageId);
      onSaveState?.(error ? "error" : "saved");
      if (error) dirty.current = true;
    };

    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === provider) return; // remote edits are saved by their author
      dirty.current = true;
      onSaveState?.("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, 1000);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer.current) clearTimeout(timer.current);
      void save();
    };
  }, [doc, provider, editor, editable, sb, pageId, onSaveState]);

  // Phones: keep the caret / selection above the docked toolbar while the keyboard is open.
  useEffect(() => {
    if (!coarse) return;
    const view = editor.prosemirrorView;
    if (!view) return;
    // ProseMirror's own scroll-into-view (typing, Enter) leaves room for the toolbar too.
    view.setProps({
      scrollMargin: { top: 64, bottom: 140, left: 0, right: 0 },
      scrollThreshold: { top: 64, bottom: 140, left: 0, right: 0 },
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const keepVisible = () => {
      const vv = window.visualViewport;
      if (!vv || window.innerHeight - vv.height * vv.scale < 150) return; // keyboard closed
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !view.dom.contains(sel.focusNode)) return;
      // Measure where the selection ends (the caret / the handle the user is moving).
      const range = document.createRange();
      range.setStart(sel.focusNode!, sel.focusOffset);
      range.collapse(true);
      let rect = range.getBoundingClientRect();
      if (!rect.height) {
        const el = (sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode?.parentElement) as Element | null;
        if (!el) return;
        rect = el.getBoundingClientRect();
      }
      const scroller = view.dom.closest(".overflow-y-auto") as HTMLElement | null;
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const bar = document.querySelector(".bn-mobile-formatting-toolbar")?.getBoundingClientRect().height ?? 48;
      const top = Math.max(box.top, vv.offsetTop) + 12;
      const bottom = Math.min(box.bottom, vv.offsetTop + vv.height) - bar - 16;
      if (rect.bottom > bottom) scroller.scrollBy({ top: rect.bottom - bottom, behavior: "smooth" });
      else if (rect.top < top) scroller.scrollBy({ top: rect.top - top, behavior: "smooth" });
    };
    const schedule = (delay = 120) => {
      clearTimeout(timer);
      timer = setTimeout(keepVisible, delay);
    };
    const unsubscribe = editor.onSelectionChange(() => schedule());
    const onResize = () => schedule(250); // keyboard opening / closing
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [coarse, editor]);

  const toolbar = useCallback(
    () => (
      <FormattingToolbar>
        {editable && onAskAI ? [<AskAIButton key="ask-ai" onAsk={onAskAI} />, ...getFormattingToolbarItems()] : getFormattingToolbarItems()}
      </FormattingToolbar>
    ),
    [editable, onAskAI],
  );

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      formattingToolbar={false}
      // Drag handles are easy to trigger by accident on touch screens and crowd narrow pages.
      sideMenu={!coarse}
      className="min-h-[40vh] pb-32 md:-mx-[54px]"
    >
      {coarse ? (
        // Phones: always dock the toolbar above the keyboard instead of floating over the selection.
        <MobileFormattingToolbarController formattingToolbar={toolbar} />
      ) : (
        <FormattingToolbarController formattingToolbar={toolbar} />
      )}
    </BlockNoteView>
  );
}
