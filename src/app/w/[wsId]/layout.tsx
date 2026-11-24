"use client";

import { use, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { WorkspaceProvider } from "@/components/workspace-context";
import { Sidebar } from "@/components/sidebar";
import { Dialogs } from "@/components/dialogs";

export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ wsId: string }> }) {
  const { wsId } = use(params);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <WorkspaceProvider workspaceId={wsId}>
      <div className="flex h-screen overflow-hidden">
        {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}
        <main className="relative min-w-0 flex-1">
          {collapsed && (
            <button onClick={() => setCollapsed(false)} title="사이드바 열기" className="absolute left-2 top-2 z-10 rounded p-1.5 text-muted hover:bg-hover">
              <PanelLeftOpen size={16} />
            </button>
          )}
          {children}
        </main>
      </div>
      <Dialogs />
    </WorkspaceProvider>
  );
}
