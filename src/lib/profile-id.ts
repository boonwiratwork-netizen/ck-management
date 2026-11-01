import { supabase } from "@/integrations/supabase/client";
import { sharedRead } from "@/lib/page-cache";

/**
 * The signed-in person's profile row id (requests and transfer orders are saved with it).
 * Read once per person for the whole app — the request and transfer pages each read it on
 * every open. Never cached as "none": a failed or empty read is asked again next time.
 */
export function profileIdOf(userId: string): Promise<string | null> {
  return sharedRead(`profile-id|${userId}`, ["profiles"], async () => {
    const { data, error } = await supabase.from("profiles").select("id").eq("user_id", userId).maybeSingle();
    if (error || !data) throw error ?? new Error("no profile");
    return data.id as string;
  }, Infinity).catch(() => null);
}
