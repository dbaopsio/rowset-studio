// A deliberately small Markdown subset for notebook notes. It produces plain
// data (never HTML strings), so rendering cannot inject markup.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "code"; text: string };

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) result.push({ type: "text", text: text.slice(last, index) });
    const token = match[0];
    if (match[1]) result.push({ type: "code", text: token.slice(1, -1) });
    else if (match[2]) result.push({ type: "bold", text: token.slice(2, -2) });
    else if (match[3]) result.push({ type: "italic", text: token.slice(1, -1) });
    else {
      const close = token.indexOf("](");
      result.push({ type: "link", text: token.slice(1, close), href: token.slice(close + 2, -1) });
    }
    last = index + token.length;
  }
  if (last < text.length) result.push({ type: "text", text: text.slice(last) });
  return result;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ type: "list", items: list });
    paragraph = [];
    list = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++index < lines.length && !lines[index].trimStart().startsWith("```")) code.push(lines[index]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, inline: parseInline(heading[2].trim()) });
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph.length) { blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) }); paragraph = []; }
      (list ??= []).push(parseInline(item[1]));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list) { blocks.push({ type: "list", items: list }); list = null; }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** First heading text, used to title an editor tab opened from a cell. */
export function headingText(source: string): string | undefined {
  const block = parseMarkdown(source).find((item) => item.type === "heading");
  return block && block.type === "heading" ? block.inline.map((part) => part.text).join("") : undefined;
}
