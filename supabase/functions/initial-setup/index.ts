import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-setup-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require pre-shared SETUP_SECRET to call this endpoint.
    // This prevents an attacker from racing the legitimate admin during
    // the bootstrap window and prevents endpoint probing.
    const expectedSecret = Deno.env.get("SETUP_SECRET");
    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Setup is disabled. SETUP_SECRET is not configured on the server." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const providedSecret =
      req.headers.get("x-setup-secret") ??
      (await req.clone().json().then((b: any) => b?.setup_secret).catch(() => null));

    if (!providedSecret || providedSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if any admin exists
    const { data: existingAdmins } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .in("role", ["admin", "management"])
      .limit(1);

    if (existingAdmins && existingAdmins.length > 0) {
      return new Response(
        JSON.stringify({ error: "Setup already completed. An admin already exists." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, password, full_name } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the admin user
    const { data: newUser, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "Admin" },
      });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Assign management role
    await supabaseAdmin.from("user_roles").insert({
      user_id: newUser.user!.id,
      role: "management",
    });

    // Update profile name
    await supabaseAdmin
      .from("profiles")
      .update({ full_name: full_name || "Admin" })
      .eq("user_id", newUser.user!.id);

    return new Response(
      JSON.stringify({ success: true, message: "Admin account created. You can now log in." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
