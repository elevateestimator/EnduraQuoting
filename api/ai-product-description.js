import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/ai-product-description
 * Body: { name: string, unit_type?: string, description?: string }
 * Returns: { description: string }
 *
 * Required env vars:
 * - OPENAI_API_KEY
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env var:
 * - OPENAI_MODEL (defaults to gpt-5-mini)
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const name = clamp(safeStr(body?.name), 120);
    const unitType = clamp(safeStr(body?.unit_type) || "Each", 60);
    const existing = clamp(safeStr(body?.description), 2000);

    if (!name) {
      res.status(400).json({ error: "Missing product name." });
      return;
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      res.status(500).json({
        error: "Missing OPENAI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables.",
      });
      return;
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }

    const authHeader = String(req.headers?.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      res.status(401).json({ error: "Missing Authorization token." });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const { data: membership, error: membershipErr } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .limit(1);

    if (membershipErr || !membership?.length) {
      res.status(403).json({ error: "No company membership found for this account." });
      return;
    }

    const mode = existing ? "enhance" : "create";
    const model = safeStr(process.env.OPENAI_MODEL) || "gpt-5-mini";

    const systemPrompt = [
      "You write short, professional descriptions for contractor products and services.",
      "The user is a contractor building a quote item.",
      "Tone should be professional, clear, and to the point.",
      "Do not use bullet points.",
      "Do not use lines that start with '-'.",
      "Do not use em dashes or dash-heavy phrasing.",
      "Do not sound overly salesy or like AI marketing copy.",
      "Do not mention price, payment terms, or financing.",
      "Return only the final description text.",
    ].join(" ");

    const userPrompt = mode === "enhance"
      ? [
          "This is a contractor asking you to improve a description for their product or service.",
          "Keep the meaning, but make it read cleaner and more professional.",
          "Write 1 or 2 short sentences.",
          `Item name: ${name}`,
          `Unit type: ${unitType}`,
          `Current description: ${existing}`,
        ].join("\n")
      : [
          "This is a contractor asking for a description for their product or service.",
          "Write a short description that explains what the item is or what is included.",
          "Write 1 or 2 short sentences.",
          `Item name: ${name}`,
          `Unit type: ${unitType}`,
        ].join("\n");

    const openAiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 180,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const openAiJson = await openAiRes.json().catch(() => null);
    if (!openAiRes.ok) {
      const msg = openAiJson?.error?.message || `OpenAI request failed (HTTP ${openAiRes.status}).`;
      res.status(502).json({ error: msg });
      return;
    }

    const raw = extractOutputText(openAiJson);
    const cleaned = cleanDescription(raw);
    if (!cleaned) {
      res.status(500).json({ error: "OpenAI returned an empty description." });
      return;
    }

    res.status(200).json({ description: cleaned });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function clamp(v, maxLen) {
  return safeStr(v).slice(0, maxLen);
}

function extractOutputText(resp) {
  if (resp && typeof resp.output_text === "string") return resp.output_text;

  const output = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c?.text === "string") return c.text;
      }
    }
  }

  const legacy = resp?.choices?.[0]?.message?.content;
  if (typeof legacy === "string") return legacy;

  return "";
}

function cleanDescription(text) {
  return safeStr(text)
    .replace(/^[\s]*[-•]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/[—–]/g, ", ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, "")
    .trim();
}
