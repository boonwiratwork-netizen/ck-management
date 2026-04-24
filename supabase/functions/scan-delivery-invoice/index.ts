// Edge function: scan-delivery-invoice
// Two-step pipeline:
//   1) Extract line items from a Thai delivery invoice/receipt (vision)
//   2) Match each extracted item to an SKU in the provided catalog (text)
// Uses Lovable AI Gateway (no external API key needed).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACT_SYSTEM_PROMPT =
  "You are reading a Thai delivery invoice or receipt. Extract every line item from the table. " +
  'Return ONLY a valid JSON object: {"items":[{"code":"<supplier product code from first column if shown, else empty string>","raw_name":"<full product description exactly as written, without size/weight info>","quantity":<number>,"unit":"<unit of measure>"}]}. ' +
  "No prose, no markdown. If a field is missing use empty string or 0.";

const MATCH_SYSTEM_PROMPT =
  "You are matching items from a delivery invoice to SKUs in a catalog. " +
  "For each scanned item, find the best-matching SKU from the catalog. " +
  "The invoice may be in Thai or English; SKU names are in Thai. " +
  "Use your understanding of both languages and product knowledge to match them. " +
  'Return ONLY valid JSON: {"matches":[{"raw_name":"<original raw_name>","sku_id":"<matched SKU\'s skuId, or empty string if no good match>","confidence":"high|low|none"}]}. ' +
  "Use 'high' only when you are confident the match is correct. " +
  "Use 'low' when the match is plausible but uncertain. " +
  "Use 'none' and empty sku_id if no SKU in the catalog reasonably matches.";

interface ExtractedItem {
  code: string;
  raw_name: string;
  quantity: number;
  unit: string;
}

interface CatalogItem {
  skuId: string;
  name: string;
}

interface MatchItem {
  raw_name: string;
  sku_id: string;
  confidence: "high" | "low" | "none";
}

function tryParseJson<T = unknown>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      imageBase64,
      mimeType,
      skuCatalog,
    } = body as { imageBase64?: string; mimeType?: string; skuCatalog?: CatalogItem[] };

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

    // ── Step 1: Extract line items ────────────────────────────────────────
    const extractResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: EXTRACT_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all line items from this delivery invoice." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!extractResp.ok) {
      const txt = await extractResp.text();
      return new Response(
        JSON.stringify({ error: `AI gateway error [${extractResp.status}]: ${txt.slice(0, 500)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const extractJson = await extractResp.json();
    const extractContent: string = extractJson?.choices?.[0]?.message?.content ?? "";
    const extractParsed = tryParseJson<{ items?: ExtractedItem[] }>(extractContent) ?? {};
    const items: ExtractedItem[] = Array.isArray(extractParsed.items) ? extractParsed.items : [];

    // ── Step 2: AI-powered SKU matching (best-effort) ─────────────────────
    let matches: MatchItem[] = [];
    const catalog = Array.isArray(skuCatalog) ? skuCatalog : [];
    if (items.length > 0 && catalog.length > 0) {
      try {
        const matchUserMsg =
          `Scanned items: ${JSON.stringify(items)}\n\n` +
          `SKU catalog: ${JSON.stringify(catalog)}\n\n` +
          `Match each scanned item to the best SKU.`;

        const matchResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: MATCH_SYSTEM_PROMPT },
              { role: "user", content: matchUserMsg },
            ],
            response_format: { type: "json_object" },
          }),
        });

        if (matchResp.ok) {
          const matchJson = await matchResp.json();
          const matchContent: string = matchJson?.choices?.[0]?.message?.content ?? "";
          const matchParsed = tryParseJson<{ matches?: MatchItem[] }>(matchContent) ?? {};
          if (Array.isArray(matchParsed.matches)) {
            matches = matchParsed.matches.filter(
              (m) =>
                m &&
                typeof m.raw_name === "string" &&
                typeof m.sku_id === "string" &&
                (m.confidence === "high" || m.confidence === "low" || m.confidence === "none"),
            );
          }
        }
      } catch (_err) {
        // Swallow — frontend will fall back to local token matcher
        matches = [];
      }
    }

    return new Response(JSON.stringify({ items, matches }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
