import { supabase } from "@/integrations/supabase/client";
import { writeError, writeTimeout } from "@/lib/write-timeout";

/**
 * Saving a recipe line's "สเปค / หมายเหตุสำหรับหน้าร้าน" (menu_bom.spec_note,
 * bom_lines.spec_note — migration 20261107000100_recipe_line_spec_note.sql).
 *
 * - Row security that filters the update out still answers 200 with no rows, so the
 *   rows that came back are counted: none = not saved.
 * - Until the migration is run the column isn't there: PostgREST answers PGRST204
 *   ("Could not find the 'spec_note' column … in the schema cache"), Postgres 42703.
 *   That is told apart so the screen can say what is missing instead of a raw error.
 *   Reads use select('*'), so a missing column just reads as no note.
 */

export type NoteTable = "menu_bom" | "bom_lines";

export type NoteSave = { kind: "ok"; note: string } | { kind: "missing-column" } | { kind: "not-saved" } | { kind: "error"; message: string };

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export const isMissingColumn = (e: DbError) => !!e && (e.code === "42703" || e.code === "PGRST204" || (/spec_note/.test(e.message ?? "") && /column/i.test(e.message ?? "")));

export async function saveLineSpecNote(table: NoteTable, id: string, note: string): Promise<NoteSave> {
  const value = note.trim();
  try {
    const { data, error } = await supabase
      .from(table)
      .update({ spec_note: value || null })
      .eq("id", id)
      .select("id")
      .abortSignal(writeTimeout());
    if (error) return isMissingColumn(error) ? { kind: "missing-column" } : { kind: "error", message: writeError(error) };
    if (!data || data.length === 0) return { kind: "not-saved" };
    return { kind: "ok", note: value };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** What the person is told when a note didn't save (null = it saved) */
export function noteSaveProblem(r: NoteSave): string | null {
  switch (r.kind) {
    case "ok":
      return null;
    case "missing-column":
      return "ยังบันทึกสเปคไม่ได้: ฐานข้อมูลยังไม่มีช่องนี้ (ต้องรันไฟล์ปรับฐานข้อมูล recipe_line_spec_note ก่อน)";
    case "not-saved":
      return "บันทึกสเปคไม่สำเร็จ: ไม่มีสิทธิ์แก้สูตรนี้ หรือบรรทัดนี้ถูกลบไปแล้ว";
    case "error":
      return "บันทึกสเปคไม่สำเร็จ: " + r.message;
  }
}
