import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { Send } from "lucide-react";
import type { RecipeSheet } from "@/lib/recipe-sheet";

// The sheet (and later the image/PDF libraries) load only when someone opens it
const RecipeSheetPanel = lazy(() => import("./RecipeSheetPanel").then((m) => ({ default: m.RecipeSheetPanel })));

interface Props {
  kind: "menu" | "sm";
  build: (multiplier: number) => RecipeSheet;
  className: string;
}

/** "ส่งสูตรให้หน้าร้าน": the button, and the sheet it opens */
export function RecipeSheetButton({ kind, build, className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <Send className="h-4 w-4 shrink-0" aria-hidden="true" /> ส่งสูตรให้หน้าร้าน
      </button>
      {/* On <body>: the button sits in coloured headers whose text colour and stacking it must not take */}
      {open &&
        createPortal(
          <Suspense fallback={null}>
            <RecipeSheetPanel kind={kind} build={build} onClose={() => setOpen(false)} />
          </Suspense>,
          document.body,
        )}
    </>
  );
}
