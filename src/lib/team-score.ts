// The team score lives with the Edge Functions' shared code so the push alerts
// (supabase/functions/alerts-run) judge teams with the very same rules as the home page.
export * from "../../supabase/functions/_shared/team-score.ts";
