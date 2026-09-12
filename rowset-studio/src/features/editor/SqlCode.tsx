import { useEffect, useState } from "react";
import { colorizeSql } from "./monacoSetup";

// Shows SQL outside the editor — an object's DDL, the statements to review
// before applying grid changes — coloured by the editor's own tokenizer and
// theme, so the same statement reads the same everywhere.
export default function SqlCode({ sql, className = "" }: { sql: string; className?: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let alive = true;
    colorizeSql(sql).then((result) => { if (alive) setHtml(result); }, () => undefined);
    return () => { alive = false; };
  }, [sql]);
  const classes = `overflow-auto whitespace-pre font-mono text-[12px] leading-5 text-[#1d1b16] dark:text-[#ece7dc] ${className}`;
  // Until Monaco answers, the same text is shown without colours.
  return html ? <pre className={classes} dangerouslySetInnerHTML={{ __html: html }} /> : <pre className={classes}>{sql}</pre>;
}
