export type Role = "owner" | "editor" | "viewer";
export type PageKind = "doc" | "database" | "row";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_color: string;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  created_by: string;
}

export interface Member {
  user_id: string;
  role: Role;
  profile: Profile;
}

export interface PageMeta {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  position: number;
  archived_at: string | null;
  updated_at: string;
}

export interface Page extends PageMeta {
  cover: string | null;
  content: unknown[];
  ydoc: string | null;
  db_schema: DbSchema | null;
  properties: Record<string, PropValue>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  game_id: string | null;
}

// ---- Web games ----
export interface Game {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  latest_build_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameBuild {
  id: string;
  game_id: string;
  version: string;
  notes: string | null;
  entry: string;
  files: { path: string; size: number; type: string | null }[];
  total_size: number;
  status: "uploading" | "ready";
  uploaded_by: string | null;
  actor: "user" | "ai";
  actor_name: string | null;
  created_at: string;
}

export const PAGE_META_COLUMNS =
  "id, workspace_id, parent_id, kind, title, icon, position, archived_at, updated_at";

// ---- Databases ----
export type OptionColor =
  | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

export type PropType =
  | "text" | "number" | "select" | "multi_select" | "status"
  | "person" | "date" | "checkbox" | "url";

export interface PropOption {
  id: string;
  name: string;
  color: OptionColor;
}

export interface DbProperty {
  id: string;
  name: string;
  type: PropType;
  options?: PropOption[];
}

export interface DbView {
  id: string;
  name: string;
  type: "table" | "board";
  groupBy?: string;
}

export interface DbSchema {
  properties: DbProperty[];
  views: DbView[];
}

export type PropValue = string | number | boolean | string[] | null;

export const OPTION_COLORS: Record<OptionColor, string> = {
  gray: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  brown: "bg-amber-200/70 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100",
  orange: "bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100",
  yellow: "bg-yellow-200 text-yellow-900 dark:bg-yellow-800/60 dark:text-yellow-100",
  green: "bg-green-200 text-green-900 dark:bg-green-900/60 dark:text-green-100",
  blue: "bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100",
  purple: "bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100",
  pink: "bg-pink-200 text-pink-900 dark:bg-pink-900/60 dark:text-pink-100",
  red: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100",
};

export const PROP_TYPE_LABELS: Record<PropType, string> = {
  text: "텍스트",
  number: "숫자",
  select: "선택",
  multi_select: "다중 선택",
  status: "상태",
  person: "사람",
  date: "날짜",
  checkbox: "체크박스",
  url: "URL",
};

export const COVERS = [
  "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
  "linear-gradient(135deg,#f093fb 0%,#f5576c 100%)",
  "linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)",
  "linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)",
  "linear-gradient(135deg,#fa709a 0%,#fee140 100%)",
  "linear-gradient(135deg,#30cfd0 0%,#330867 100%)",
  "linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)",
  "linear-gradient(135deg,#ff9a00 0%,#ff0058 100%)",
];

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10);
}
