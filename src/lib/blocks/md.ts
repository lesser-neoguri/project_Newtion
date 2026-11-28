import { fromMdBlocks, toMdBlocks } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ed = { blocksToMarkdownLossy: (b: any[]) => string; tryParseMarkdownToBlocks: (md: string) => any[] };

/** Markdown of blocks, with Newtion's custom blocks as ```newtion-*``` JSON fences. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blocksToMd = (editor: Ed, blocks: any[]) => editor.blocksToMarkdownLossy(toMdBlocks(blocks));

/** Blocks from Markdown, turning ```newtion-*``` fences back into custom blocks. */
export const mdToBlocks = (editor: Ed, md: string) => fromMdBlocks(editor.tryParseMarkdownToBlocks(md));
