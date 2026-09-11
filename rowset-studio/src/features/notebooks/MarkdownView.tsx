import { Fragment } from "react";
import { parseMarkdown, type Inline } from "./markdown";

function InlineView({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.type) {
          case "bold": return <strong key={index}>{part.text}</strong>;
          case "italic": return <em key={index}>{part.text}</em>;
          case "code": return <code key={index} className="rounded bg-slate-100 px-1 font-mono text-[12px] dark:bg-slate-800">{part.text}</code>;
          case "link": return <a key={index} href={part.href} target="_blank" rel="noreferrer noopener" className="text-brand-600 underline">{part.text}</a>;
          default: return <Fragment key={index}>{part.text}</Fragment>;
        }
      })}
    </>
  );
}

export default function MarkdownView({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  if (!blocks.length) return <p className="text-[13px] text-slate-400">Empty note</p>;
  return (
    <div className="space-y-2 text-[13px] leading-6 text-slate-700 dark:text-slate-200">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const size = block.level === 1 ? "text-[18px]" : block.level === 2 ? "text-[15px]" : "text-[14px]";
            return <p key={index} className={`${size} font-semibold text-slate-900 dark:text-slate-50`}><InlineView parts={block.inline} /></p>;
          }
          case "list": return <ul key={index} className="list-disc space-y-0.5 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineView parts={item} /></li>)}</ul>;
          case "code": return <pre key={index} className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[12px] dark:bg-slate-900">{block.text}</pre>;
          default: return <p key={index}><InlineView parts={block.inline} /></p>;
        }
      })}
    </div>
  );
}
