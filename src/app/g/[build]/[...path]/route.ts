/**
 * Serves an uploaded web game build: /g/<build_id>/<path>.
 *
 * - The HTML entry is proxied with `Content-Security-Policy: sandbox`, so the game runs in an
 *   opaque origin even if the URL is opened directly: uploaded code can never read Newtion's
 *   cookies, storage or session.
 * - Everything else (.js, .wasm, .data, assets) redirects to the public storage URL, so large files
 *   never pass through this function. Relative URLs in Emscripten's loader keep pointing here.
 */
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = { "Access-Control-Allow-Origin": "*" };

function storageUrl(build: string, path: string[]) {
  const key = [build, ...path].map(encodeURIComponent).join("/");
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/games/${key}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ build: string; path: string[] }> }) {
  const { build, path } = await params;
  if (!UUID.test(build) || !path?.length || path.some((p) => p === ".." || p === "")) {
    return new Response("Not found", { status: 404, headers: CORS });
  }
  const target = storageUrl(build, path);

  if (!/\.html?$/i.test(path[path.length - 1])) {
    // Builds are immutable: once a file exists at this path it never changes.
    return new Response(null, {
      status: 307,
      headers: { ...CORS, Location: target, "Cache-Control": "public, max-age=300" },
    });
  }

  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) return new Response("게임 파일을 찾을 수 없어요.", { status: 404, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(res.body, {
    headers: {
      ...CORS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Content-Security-Policy": "sandbox allow-scripts allow-pointer-lock allow-popups allow-modals allow-downloads allow-forms",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" } });
}
