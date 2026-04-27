import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the caller is management
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");

    // Use anon client with the user's token to validate via getClaims (signing-keys system)
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      console.error("Auth failed:", claimsError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub;

    // Check management role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .single();

    if (!roleData || (roleData.role !== "management" && roleData.role !== "admin")) {
      return new Response(JSON.stringify({ error: "Forbidden: Management only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, ...params } = await req.json();

    if (action === "create") {
      const { email, password, full_name, role, branch_id } = params;

      const { data: newUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name },
        });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Assign role
      await supabaseAdmin.from("user_roles").insert({
        user_id: newUser.user!.id,
        role: role || "ck_manager",
      });

      // Update profile name and branch_id
      const profileUpdate: Record<string, unknown> = { full_name };
      if (branch_id) profileUpdate.branch_id = branch_id;
      await supabaseAdmin
        .from("profiles")
        .update(profileUpdate)
        .eq("user_id", newUser.user!.id);

      return new Response(
        JSON.stringify({ user: newUser.user }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "update_status") {
      const { user_id, status } = params;
      await supabaseAdmin
        .from("profiles")
        .update({ status })
        .eq("user_id", user_id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "update_role") {
      const { user_id, role } = params;
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", user_id);

      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id, role });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "reset_password") {
      const { user_id, new_password } = params;
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        user_id,
        { password: new_password }
      );

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list_users") {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("*");

      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("*");

      const { data: { users: authUsers } } =
        await supabaseAdmin.auth.admin.listUsers();

      const result = (profiles || []).map((p) => {
        const userRole = roles?.find((r) => r.user_id === p.user_id);
        const authUser = authUsers?.find((u) => u.id === p.user_id);
        return {
          ...p,
          email: authUser?.email || "",
          role: userRole?.role || "ck_manager",
        };
      });

      return new Response(
        JSON.stringify({ users: result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
