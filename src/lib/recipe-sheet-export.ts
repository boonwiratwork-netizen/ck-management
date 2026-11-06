/**
 * The browser side of "ส่งสูตรให้หน้าร้าน": the sheet as an image (share to LINE on a
 * phone, download on a computer), as a PDF, and on the clipboard.
 *
 * - The image is drawn from the DOM (html-to-image), so Thai shapes exactly as on screen
 *   with the app's own font. The PDF is that same image placed in jsPDF pages — never
 *   jsPDF text, which has no Thai shaping.
 * - Both libraries load only when someone uses them (dynamic import): the main bundle
 *   doesn't carry them.
 */
import { pageCuts } from "@/lib/recipe-sheet";

/** Browsers cap canvas size (iOS Safari ~16.7 M pixels); stay well under */
const MAX_CANVAS_PIXELS = 14_000_000;

export interface RenderedSheet {
  canvas: HTMLCanvasElement;
  /** CSS px of the node that was drawn */
  width: number;
  height: number;
  /** canvas px per CSS px */
  scale: number;
}

/**
 * Draw the (off-screen) sheet node. The node sits off screen with position:fixed, so the
 * copy is put back in normal flow at 0,0 before drawing (else the picture is empty).
 * Fonts are embedded from the page's stylesheets; if that fails (a blocked font file)
 * it is drawn again with the device's own fonts, which still shape Thai.
 */
export async function renderSheet(node: HTMLElement): Promise<RenderedSheet> {
  const { toCanvas } = await import("html-to-image");
  const width = node.scrollWidth;
  const height = node.scrollHeight;
  const scale = Math.max(1, Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height))));
  const options = {
    width,
    height,
    pixelRatio: scale,
    backgroundColor: "#ffffff",
    cacheBust: false,
    style: { position: "static", left: "0", top: "0", transform: "none", margin: "0" } as Partial<CSSStyleDeclaration>,
  };
  let canvas: HTMLCanvasElement;
  try {
    canvas = await toCanvas(node, options);
  } catch {
    canvas = await toCanvas(node, { ...options, skipFonts: true });
  }
  return { canvas, width, height, scale };
}

export function canvasBlob(canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png", quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ทำภาพไม่สำเร็จ"))), type, quality));
}

/** Save a file the ordinary way (a link click) */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL goes
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A phone (touch first) that can hand files to other apps: share instead of download */
export function canShareFile(file: File): boolean {
  try {
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    return coarse && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * A landscape A4 PDF: the image scaled to the page width; a tall sheet goes on as many
 * pages as it needs, cut between rows (rowEdges = row bottoms in CSS px of the node).
 */
export async function sheetPdf(r: RenderedSheet, rowEdges: number[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const margin = 8;
  const pageW = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageH = pdf.internal.pageSize.getHeight() - margin * 2;
  const mmPerCss = pageW / r.width;
  const cuts = pageCuts(r.height, pageH / mmPerCss, rowEdges);
  for (let i = 0; i < cuts.length - 1; i++) {
    const top = cuts[i];
    const h = cuts[i + 1] - top;
    const slice = document.createElement("canvas");
    slice.width = r.canvas.width;
    slice.height = Math.max(1, Math.round(h * r.scale));
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("ทำ PDF ไม่สำเร็จ");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(r.canvas, 0, Math.round(top * r.scale), r.canvas.width, slice.height, 0, 0, slice.width, slice.height);
    if (i > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, pageW, h * mmPerCss);
  }
  return pdf.output("blob");
}

/**
 * Copy as a table: HTML (pastes as a real table in Google Docs/Sheets) plus TSV text
 * (anything else). Where the clipboard API is missing or refused (old browsers, a page
 * without clipboard permission) the selection-and-copy-command way is tried.
 */
export async function copyTable(html: string, tsv: string): Promise<"table" | "text"> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([tsv], { type: "text/plain" }) })]);
      return "table";
    } catch {
      // fall through to the copy command
    }
  }
  if (execCopy((el) => (el.innerHTML = html), true)) return "table";
  await copyText(tsv);
  return "text";
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      return await navigator.clipboard.writeText(text);
    } catch {
      // fall through to the copy command
    }
  }
  if (!execCopy((el) => (el.textContent = text), false)) throw new Error("เบราว์เซอร์ไม่ให้คัดลอก");
}

/** The old way: put the content in a hidden box, select it, run the copy command */
function execCopy(fill: (el: HTMLElement) => void, rich: boolean): boolean {
  const box = document.createElement(rich ? "div" : "pre");
  if (rich) box.contentEditable = "true";
  box.style.cssText = `position:fixed;left:-10000px;top:0;opacity:0;${rich ? "" : "white-space:pre;"}`;
  fill(box);
  document.body.appendChild(box);
  try {
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand("copy");
    sel?.removeAllRanges();
    return ok;
  } catch {
    return false;
  } finally {
    box.remove();
  }
}
