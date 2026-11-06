-- "ส่งสูตรให้หน้าร้าน" (7 Nov 2026): a per-recipe-line note for the shop
-- ("สเปค / หมายเหตุสำหรับหน้าร้าน"), shown on the recipe sheet before the SKU's own
-- skus.spec_note. Nullable, no default: existing lines simply have no note.
--
-- Row security: the existing table policies cover it (they are per row, not per
-- column) — menu_bom: management writes; bom_lines: management or ck_manager writes
-- (20261026090000_cost_center_foundation); reads stay as they are. Nothing to add.
-- History: change_log's trigger records whole rows, so a note change is logged like any
-- other edit; recipe_history snapshots name their columns and leave the note out, so a
-- note change never adds a recipe version.

alter table public.menu_bom add column if not exists spec_note text;
alter table public.bom_lines add column if not exists spec_note text;

comment on column public.menu_bom.spec_note is 'Spec / note for the shop on this recipe line (recipe sheet). Null = none; the sheet falls back to skus.spec_note.';
comment on column public.bom_lines.spec_note is 'Spec / note for the shop on this recipe line (recipe sheet). Null = none; the sheet falls back to skus.spec_note.';

-- PostgREST reads the schema at start: tell it about the new columns now
notify pgrst, 'reload schema';
