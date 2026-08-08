// highlight — a tiny, dependency-free syntax highlighter for tool output.
// Detects the likely language (JSON / Python / shell / plain) and tokenizes
// into colored React spans. No external libs, no dangerouslySetInnerHTML —
// output is rendered as React elements, so it stays XSS-safe.

import React from "react";
import { tokens } from "../../design/tokens";

type CSS = React.CSSProperties;

// Palette tuned to the terminal-minimal aesthetic (green / amber / cyan).
const C = {
  keyword: tokens.color.accentHover, // terminal green (light)
  string: tokens.color.ok, // terminal green
  number: tokens.color.warning, // amber
  comment: tokens.color.textDim,
  key: tokens.color.tool, // cyan
  bool: tokens.color.warning, // amber
  func: tokens.color.accentHover, // terminal green (light)
  plain: tokens.color.textMuted,
  punct: tokens.color.textDim,
};

export type Lang = "json" | "python" | "shell" | "plain";

export function detectLang(text: string): Lang {
  const t = text.trim();
  if (!t) return "plain";
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (/\b(def|class|import|from|return|print|if|elif|else|for|while)\b/.test(t)) return "python";
  if (/^(\$|#|(?:sudo|cd|ls|cat|git|npm|pip|node|python|curl|wget)\s)/m.test(t)) return "shell";
  return "plain";
}

// ---------------------------------------------------------------------------
// Tokenizers — each returns an array of { text, cls } tokens.
// ---------------------------------------------------------------------------

interface Tok {
  text: string;
  cls: keyof typeof C;
}

function tokenizeJson(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), cls: "plain" });
    if (m[1]) {
      // string — key if followed by a colon, else value
      out.push({ text: m[1], cls: m[2] ? "key" : "string" });
      if (m[2]) out.push({ text: m[2], cls: "punct" });
    } else if (m[3]) {
      out.push({ text: m[3], cls: "number" });
    } else if (m[4]) {
      out.push({ text: m[4], cls: "bool" });
    } else if (m[5]) {
      out.push({ text: m[5], cls: "punct" });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: "plain" });
  return out;
}

const PY_KEYWORDS =
  /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|lambda|yield|global|nonlocal|raise|assert|del|in|is|not|and|or|None|True|False|async|await|self)\b/g;

function tokenizePython(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-?\d+(?:\.\d+)?)|(\bdef\b|\bclass\b)|([()\[\]{},.:=+\-*/%<>!&|])/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      const seg = text.slice(last, m.index);
      // keywords within the plain segment
      let klast = 0;
      let km: RegExpExecArray | null;
      PY_KEYWORDS.lastIndex = 0;
      while ((km = PY_KEYWORDS.exec(seg))) {
        if (km.index > klast) out.push({ text: seg.slice(klast, km.index), cls: "plain" });
        out.push({ text: km[0], cls: "keyword" });
        klast = PY_KEYWORDS.lastIndex;
      }
      if (klast < seg.length) out.push({ text: seg.slice(klast), cls: "plain" });
    }
    if (m[1]) out.push({ text: m[1], cls: "comment" });
    else if (m[2]) out.push({ text: m[2], cls: "string" });
    else if (m[3]) out.push({ text: m[3], cls: "number" });
    else if (m[4]) out.push({ text: m[4], cls: "func" });
    else if (m[5]) out.push({ text: m[5], cls: "punct" });
    last = re.lastIndex;
  }
  if (last < text.length) {
    const seg = text.slice(last);
    let klast = 0;
    let km: RegExpExecArray | null;
    PY_KEYWORDS.lastIndex = 0;
    while ((km = PY_KEYWORDS.exec(seg))) {
      if (km.index > klast) out.push({ text: seg.slice(klast, km.index), cls: "plain" });
      out.push({ text: km[0], cls: "keyword" });
      klast = PY_KEYWORDS.lastIndex;
    }
    if (klast < seg.length) out.push({ text: seg.slice(klast), cls: "plain" });
  }
  return out;
}

function tokenizeShell(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-{1,2}[a-zA-Z][\w-]*)|(\$[A-Za-z_][\w]*)|([|&;<>])/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), cls: "plain" });
    if (m[1]) out.push({ text: m[1], cls: "comment" });
    else if (m[2]) out.push({ text: m[2], cls: "string" });
    else if (m[3]) out.push({ text: m[3], cls: "keyword" });
    else if (m[4]) out.push({ text: m[4], cls: "number" });
    else if (m[5]) out.push({ text: m[5], cls: "punct" });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: "plain" });
  return out;
}

function tokenizePlain(text: string): Tok[] {
  return [{ text, cls: "plain" }];
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function HighlightedCode({ code, lang, style }: { code: string; lang?: Lang; style?: CSS }) {
  const detected = lang ?? detectLang(code);
  const tokensArr =
    detected === "json" ? tokenizeJson(code) : detected === "python" ? tokenizePython(code) : detected === "shell" ? tokenizeShell(code) : tokenizePlain(code);

  return (
    <pre
      style={{
        margin: 0,
        fontFamily: tokens.font.mono,
        fontSize: tokens.font.size.xs,
        lineHeight: 1.6,
        color: C.plain,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        ...style,
      }}
    >
      {tokensArr.map((t, i) => (
        <span key={i} style={{ color: C[t.cls] }}>
          {t.text}
        </span>
      ))}
    </pre>
  );
}
