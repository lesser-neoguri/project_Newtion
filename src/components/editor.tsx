"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  MobileFormattingToolbarController,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
} from "@blocknote/react";
import { ImagePlus, Sparkles } from "lucide-react";
import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration, YjsThreadStore } from "@blocknote/core/yjs";
import { CommentsExtension, DefaultThreadStoreAuth } from "@blocknote/core/comments";
import { useWorkspace } from "./workspace-context";
import { newtionSchema, slashItems } from "./blocks/schema";
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
  /** Edit a branch's working copy instead of the page (own realtime room, saved to page_branches). */
  branchId?: string;
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

/** Toolbar button: pick one or more images and insert them below the current block. */
function ImageButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!Components) return null;

  const onFiles = async (files: File[]) => {
    if (!files.length || !editor.uploadFile) return;
    setBusy(true);
    try {
      let anchor = editor.getTextCursorPosition().block;
      for (const file of files) {
        // Insert a placeholder right away, then point it at the uploaded file.
        const placeholder = { type: "image", props: { name: file.name } } as never;
        const empty = Array.isArray(anchor.content) && anchor.content.length === 0 && anchor.type === "paragraph";
        const [block] = empty ? editor.replaceBlocks([anchor], [placeholder]).insertedBlocks : editor.insertBlocks([placeholder], anchor, "after");
        try {
          const url = await editor.uploadFile(file, block.id);
          editor.updateBlock(block, { props: { url: typeof url === "string" ? url : "" } } as never);
        } catch (e) {
          editor.removeBlocks([block]);
          alert(`이미지 업로드 실패: ${file.name}\n${e instanceof Error ? e.message : ""}`);
        }
        anchor = editor.getBlock(block.id) ?? anchor;
      }
      // Leave an empty line under the images so typing can continue.
      const next = editor.getNextBlock(anchor);
      if (!next) editor.insertBlocks([{ type: "paragraph" }], anchor, "after");
      const target = editor.getNextBlock(anchor);
      if (target) editor.setTextCursorPosition(target, "start");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void onFiles(f); }}
      />
      <Components.FormattingToolbar.Button
        mainTooltip="이미지 넣기 (붙여넣기·끌어다 놓기도 돼요)"
        label="이미지"
        isDisabled={busy}
        // Keep the editor focused so the toolbar (and phone keyboard) don't jump.
        onClick={() => input.current?.click()}
      >
        <span className="flex items-center gap-1 px-0.5 text-[13px]">
          <ImagePlus size={15} />{busy ? "…" : ""}
        </span>
      </Components.FormattingToolbar.Button>
    </>
  );
}

/** Read-only access to comment threads. */
class ViewerThreadAuth extends DefaultThreadStoreAuth {
  constructor(userId: string) { super(userId, "comment"); }
  canCreateThread() { return false; }
  canAddComment() { return false; }
  canResolveThread() { return false; }
  canUnresolveThread() { return false; }
  canAddReaction() { return false; }
  canDeleteReaction() { return false; }
}

/** A small round avatar (initial on the member's color) as a data URL, for comment threads. */
function avatarDataUrl(name: string, color: string) {
  const ch = [...name.trim()][0]?.toUpperCase() ?? "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="${color}"/><text x="32" y="42" font-family="sans-serif" font-size="28" font-weight="600" fill="#fff" text-anchor="middle">${ch.replace(/[<&"]/g, "")}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The formatting toolbar, except on Newtion's own blocks (they have their own controls). */
function TextToolbar({ children }: { children: React.ReactNode }) {
  const editor = useBlockNoteEditor();
  const type = editor.getTextCursorPosition().block.type as string;
  if (OWN_BLOCKS.has(type)) return null;
  return <FormattingToolbar>{children}</FormattingToolbar>;
}
const OWN_BLOCKS = new Set(["cards", "timeline", "pixelCode", "spriteSheet", "pixelArt", "curve", "dropTable", "recipe"]);

function hiddenCursor() {
  const s = document.createElement("span");
  s.style.display = "none";
  return s;
}

/** Same markup as BlockNote's default collaboration cursor. */
function cursorEl(user: { name: string; color: string }) {
  const hex = user.color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.length === 3 ? hex[i / 2] + hex[i / 2] : hex.slice(i, i + 2), 16) || 0);
  const text = 0.299 * r + 0.587 * g + 0.114 * b < 150 ? "white" : "black";
  const base = document.createElement("span");
  base.classList.add("bn-collaboration-cursor__base");
  const caret = document.createElement("span");
  caret.setAttribute("contenteditable", "false");
  caret.classList.add("bn-collaboration-cursor__caret");
  caret.setAttribute("style", `background-color: ${user.color}; color: ${text}`);
  const label = document.createElement("span");
  label.classList.add("bn-collaboration-cursor__label");
  label.setAttribute("style", `background-color: ${user.color}; color: ${text}`);
  label.textContent = user.name;
  caret.appendChild(label);
  base.append("\u2060", caret, "\u2060");
  return base;
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
    const room = props.branchId ? `branch:${props.branchId}` : props.pageId;
    const provider = new SupabaseYProvider(props.sb, room, doc);
    setSession({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
      setSession(null);
    };
    // Re-create only when switching pages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pageId, props.branchId]);

  if (!session) return null;
  return <EditorInner key={props.branchId ?? props.pageId} {...props} doc={session.doc} provider={session.provider} />;
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
  sb, pageId, workspaceId, initialContent, me, editable, onSaveState, onEditor, onAskAI, branchId, doc, provider,
}: Props & { doc: Y.Doc; provider: SupabaseYProvider }) {
  const theme = useColorScheme();
  const coarse = useCoarsePointer();
  const fragment = doc.getXmlFragment("document-store");
  const { members, role } = useWorkspace();

  // Comments on selected text: threads live in the same Y.Doc (map "threads"), so they sync live
  // and are saved with the page. Viewers can read threads but not write (they can't save the page).
  const membersRef = useRef(members);
  membersRef.current = members;
  const comments = useMemo(() => {
    const auth = role === "viewer" ? new ViewerThreadAuth(me.id) : new DefaultThreadStoreAuth(me.id, "editor");
    return CommentsExtension({
      threadStore: new YjsThreadStore(me.id, doc.getMap("threads"), auth),
      resolveUsers: async (ids: string[]) => ids.map((id) => {
        const p = membersRef.current.find((m) => m.user_id === id)?.profile;
        const name = p?.display_name || p?.email || "알 수 없음";
        return { id, username: name, avatarUrl: avatarDataUrl(name, p?.avatar_color ?? "#9ca3af") };
      }),
    });
  }, [doc, me.id, role]);

  const editor = useCreateBlockNote(
    withCollaboration({
      dictionary: {
        ...ko,
        placeholders: { ...ko.placeholders, emptyDocument: "'/'를 입력해 명령어 사용", default: "'/'를 입력해 명령어 사용" },
      },
      schema: newtionSchema,
      uploadFile: (file: File) => uploadFile(sb, workspaceId, file),
      extensions: [comments],
      collaboration: {
        fragment,
        provider,
        user: { id: me.id, name: me.display_name || me.email, color: me.avatar_color },
        // Your own other tabs/devices are not "someone else": don't draw their cursors.
        renderCursor: (user: { id?: string; name: string; color: string }) => (user.id === me.id ? hiddenCursor() : cursorEl(user)),
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
        .from(branchId ? "page_branches" : "pages")
        .update({ ydoc: toB64(Y.encodeStateAsUpdate(doc)), content: editor.document })
        .eq("id", branchId ?? pageId);
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
  }, [doc, provider, editor, editable, sb, pageId, branchId, onSaveState]);

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
      <TextToolbar>
        {[
          ...(editable && onAskAI ? [<AskAIButton key="ask-ai" onAsk={onAskAI} />] : []),
          ...(editable ? [<ImageButton key="image" />] : []),
          ...getFormattingToolbarItems(),
        ]}
      </TextToolbar>
    ),
    [editable, onAskAI],
  );

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      formattingToolbar={false}
      slashMenu={false}
      // Drag handles are easy to trigger by accident on touch screens and crowd narrow pages.
      sideMenu={!coarse}
      className="min-h-[40vh] pb-32 md:-mx-[54px]"
    >
      <SuggestionMenuController triggerCharacter="/" getItems={(q) => slashItems(editor, q)} />
      {coarse ? (
        // Phones: always dock the toolbar above the keyboard instead of floating over the selection.
        <MobileFormattingToolbarController formattingToolbar={toolbar} />
      ) : (
        <FormattingToolbarController formattingToolbar={toolbar} />
      )}
    </BlockNoteView>
  );
}
