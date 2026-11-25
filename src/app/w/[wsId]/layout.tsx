"use client";

import { use, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftOpen } from "lucide-react";
import { WorkspaceProvider } from "@/components/workspace-context";
import { Sidebar } from "@/components/sidebar";
import { Dialogs } from "@/components/dialogs";
import { ChatWidget } from "@/components/chat-widget";

export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ wsId: string }> }) {
  const { wsId } = use(params);
  const pathname = usePathname();
  // Desktop: sidebar can be collapsed. Phone: sidebar is a drawer, closed by default.
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // Close the drawer after navigating.
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <WorkspaceProvider workspaceId={wsId}>
      <div className="ws-root flex h-dvh overflow-hidden">
        {/* Desktop sidebar */}
        {!collapsed && (
          <div className="hidden md:flex">
            <Sidebar onCollapse={() => setCollapsed(true)} />
          </div>
        )}

        {/* Mobile drawer */}
        <div className={`fixed inset-0 z-[92] md:hidden ${drawer ? "" : "pointer-events-none"}`}>
          <div
            onClick={() => setDrawer(false)}
            className={`absolute inset-0 bg-black/40 transition-opacity ${drawer ? "opacity-100" : "opacity-0"}`}
          />
          <div className={`absolute inset-y-0 left-0 flex w-[82vw] max-w-72 shadow-2xl transition-transform ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
            <Sidebar onCollapse={() => setDrawer(false)} />
          </div>
        </div>

        <main data-collapsed={collapsed || undefined} className="relative flex min-w-0 flex-1 flex-col">
          {/* Mobile menu button (pages leave room for it at the top-left) */}
          <button
            onClick={() => setDrawer(true)}
            title="메뉴"
            className="absolute left-1 top-1 z-20 rounded p-2 text-muted hover:bg-hover md:hidden"
          >
            <Menu size={20} />
          </button>
          {collapsed && (
            <button onClick={() => setCollapsed(false)} title="사이드바 열기" className="absolute left-2 top-1.5 z-20 hidden rounded p-1.5 text-muted hover:bg-hover md:block">
              <PanelLeftOpen size={16} />
            </button>
          )}
          <div className="min-h-0 flex-1">{children}</div>
        </main>
      </div>
      <Dialogs />
      <ChatWidget />
    </WorkspaceProvider>
  );
}
