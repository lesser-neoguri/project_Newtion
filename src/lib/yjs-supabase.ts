import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export const toB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Minimal Yjs provider that syncs a Y.Doc and its awareness (cursors)
 * through a Supabase Realtime broadcast channel.
 * Persistence is handled separately (the page's `ydoc` column).
 */
export class SupabaseYProvider {
  readonly awareness: Awareness;
  private channel: RealtimeChannel;
  private connected = false;
  private syncedListeners = new Set<() => void>();
  synced = false;

  constructor(
    private sb: SupabaseClient,
    private room: string,
    readonly doc: Y.Doc,
  ) {
    this.awareness = new Awareness(doc);
    this.channel = sb.channel(`ydoc:${room}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    this.channel
      .on("broadcast", { event: "update" }, ({ payload }) => {
        Y.applyUpdate(this.doc, fromB64(payload.u), this);
      })
      .on("broadcast", { event: "sync-req" }, ({ payload }) => {
        // Someone joined: send them what they are missing, and ask for what we are missing.
        const diff = Y.encodeStateAsUpdate(this.doc, fromB64(payload.sv));
        this.send("sync-res", {
          to: payload.from,
          u: toB64(diff),
          sv: toB64(Y.encodeStateVector(this.doc)),
        });
        this.send("awareness", {
          u: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])),
        });
      })
      .on("broadcast", { event: "sync-res" }, ({ payload }) => {
        if (payload.to !== this.doc.clientID) return;
        Y.applyUpdate(this.doc, fromB64(payload.u), this);
        const back = Y.encodeStateAsUpdate(this.doc, fromB64(payload.sv));
        if (back.length > 2) this.send("update", { u: toB64(back) });
        this.markSynced();
      })
      .on("broadcast", { event: "awareness" }, ({ payload }) => {
        applyAwarenessUpdate(this.awareness, fromB64(payload.u), this);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.connected = true;
          this.send("sync-req", {
            from: this.doc.clientID,
            sv: toB64(Y.encodeStateVector(this.doc)),
          });
          this.send("awareness", {
            u: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])),
          });
          // Nobody answered → we are alone, consider ourselves synced.
          setTimeout(() => this.markSynced(), 900);
        }
      });

    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    if (typeof window !== "undefined") window.addEventListener("beforeunload", this.onUnload);
  }

  onSynced(cb: () => void) {
    if (this.synced) cb();
    else this.syncedListeners.add(cb);
  }

  private markSynced() {
    if (this.synced) return;
    this.synced = true;
    this.syncedListeners.forEach((cb) => cb());
    this.syncedListeners.clear();
  }

  private send(event: string, payload: Record<string, unknown>) {
    if (!this.connected) return;
    void this.channel.send({ type: "broadcast", event, payload });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.send("update", { u: toB64(update) });
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    const changed = added.concat(updated, removed);
    this.send("awareness", { u: toB64(encodeAwarenessUpdate(this.awareness, changed)) });
  };

  private onUnload = () => {
    removeAwarenessStates(this.awareness, [this.doc.clientID], "unload");
  };

  destroy() {
    removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", this.onUnload);
    void this.sb.removeChannel(this.channel);
  }
}
