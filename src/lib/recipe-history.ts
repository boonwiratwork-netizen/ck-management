// Lives with the Edge Functions' shared code (the LINE bot uses it too); the app reads
// days in the device's time, as it always did.
import { toLocalDateStr } from "@/lib/utils";
import { copiesOn as sharedCopiesOn, smRecipesOn as sharedSmRecipesOn, usageContextOn as sharedUsageContextOn, type RecipeCopy, type SmCopy, type UsageInput } from "../../supabase/functions/_shared/recipe-history.ts";

export type { RecipeCopy, SmCopy, UsageInput };

const deviceDay = (iso: string) => toLocalDateStr(new Date(iso));
export const copiesOn = (copies: RecipeCopy[]) => sharedCopiesOn(copies, deviceDay);
export const usageContextOn = (today: UsageInput, copies: RecipeCopy[]) => sharedUsageContextOn(today, copies, deviceDay);
export const smRecipesOn = (copies: RecipeCopy[], date: string) => sharedSmRecipesOn(copies, date, deviceDay);
