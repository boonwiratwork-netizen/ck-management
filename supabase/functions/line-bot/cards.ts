// A small table card, built from tool results only, and its LINE Flex form.
// Plain TypeScript (Deno and the tests).

export interface Card {
  title: string;
  subtitle?: string;
  /** A big number under the title (e.g. "31.0%") */
  headline?: string;
  columns: string[];
  rows: string[][];
  /** A bold last row */
  total?: string[];
  notes?: string[];
}

const BRAND = "#F26B1D";
const MUTED = "#6B6F76";
const INK = "#141414";
// First column takes the room; the number columns stay narrow and right-aligned
const flexOf = (i: number, cols: number) => (i === 0 ? (cols >= 3 ? 5 : 4) : 3);
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function row(cells: string[], opts: { bold?: boolean; color?: string; size?: string } = {}) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: cells.map((c, i) => ({
      type: "text",
      text: cut(c === "" ? " " : c, 120),
      size: opts.size ?? "xs",
      wrap: true,
      flex: flexOf(i, cells.length),
      align: i === 0 ? "start" : "end",
      weight: opts.bold ? "bold" : "regular",
      color: opts.color ?? INK,
    })),
  };
}

/** One Flex bubble (LINE's card); altText is what a phone notification shows */
export function toFlex(card: Card): { type: "flex"; altText: string; contents: unknown } {
  const body: unknown[] = [];
  if (card.headline) body.push({ type: "text", text: card.headline, size: "xxl", weight: "bold", color: BRAND });
  if (card.columns.some((c) => c)) body.push(row(card.columns, { color: MUTED }));
  body.push({ type: "separator", margin: "sm" });
  for (const r of card.rows.slice(0, 20)) body.push(row(r));
  if (card.total) {
    body.push({ type: "separator", margin: "sm" });
    body.push(row(card.total, { bold: true }));
  }
  const notes = (card.notes ?? []).filter(Boolean).slice(0, 8);
  return {
    type: "flex",
    altText: cut(`${card.title}${card.headline ? ` ${card.headline}` : ""}`, 380),
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "vertical",
        paddingBottom: "none",
        contents: [
          { type: "text", text: cut(card.title, 120), weight: "bold", size: "md", wrap: true, color: INK },
          ...(card.subtitle ? [{ type: "text", text: cut(card.subtitle, 160), size: "xxs", color: MUTED, wrap: true }] : []),
        ],
      },
      body: { type: "box", layout: "vertical", spacing: "xs", contents: body },
      ...(notes.length
        ? { footer: { type: "box", layout: "vertical", spacing: "xs", contents: notes.map((t) => ({ type: "text", text: cut(t, 300), size: "xxs", color: MUTED, wrap: true })) } }
        : {}),
    },
  };
}
