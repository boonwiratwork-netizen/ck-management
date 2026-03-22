import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { assumptionText, smSkus, branchName } = await req.json();

    if (!assumptionText || !smSkus || !Array.isArray(smSkus)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: assumptionText, smSkus" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const skuListText = smSkus
      .map((s: { skuId: string; skuCode: string; skuName: string }) => `- ${s.skuCode}: ${s.skuName} (id: ${s.skuId})`)
      .join("\n");

    const systemPrompt = `You are parsing a Thai restaurant manager's production assumption for branch "${branchName}".
The manager describes their expected daily sales volume and product mix in Thai language.
You must extract:
1. forecast_value: the number of bowls per day they expect to sell
2. assumption_mix: a mapping of SM SKU id to grams per bowl consumed

Available SM SKUs for this brand:
${skuListText}

Rules:
- Map menu/product names mentioned to the closest matching SKU by name similarity
- If the manager mentions percentages or ratios, distribute grams proportionally
- If no specific mix is given, split equally across all SKUs
- A typical bowl uses 150-250g total of SM ingredients
- If no bowl count is explicitly stated, try to infer from context
- Return ONLY valid JSON with no markdown, no preamble, no explanation

Output format:
{"forecast_value": <number>, "forecast_unit": "bowls_per_day", "assumption_mix": {"<sku_id>": <grams_per_bowl>, ...}}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: assumptionText },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "parse_assumption",
              description: "Parse a Thai restaurant manager's production assumption into structured forecast data",
              parameters: {
                type: "object",
                properties: {
                  forecast_value: {
                    type: "number",
                    description: "Expected bowls sold per day",
                  },
                  forecast_unit: {
                    type: "string",
                    enum: ["bowls_per_day"],
                  },
                  assumption_mix: {
                    type: "object",
                    description: "Mapping of SM SKU id to grams per bowl",
                    additionalProperties: { type: "number" },
                  },
                },
                required: ["forecast_value", "forecast_unit", "assumption_mix"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "parse_assumption" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiResult = await response.json();

    // Extract from tool call response
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: "AI returned unexpected format" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: any;
    try {
      parsed = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } catch {
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate structure
    if (
      typeof parsed.forecast_value !== "number" ||
      typeof parsed.assumption_mix !== "object"
    ) {
      return new Response(
        JSON.stringify({ error: "AI returned incomplete data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-assumption error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
