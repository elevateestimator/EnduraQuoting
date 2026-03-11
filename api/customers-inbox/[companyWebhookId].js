import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const PIPELINE_STATUSES = new Set(["new", "contacted", "qualified", "won", "lost"]);
const LEAD_SOURCES = new Set(["manual", "website", "phone", "referral", "zapier", "make", "meta", "other"]);

export default async function handler(req, res) {
  const companyWebhookId = safeStr(req.query?.companyWebhookId);
  if (!companyWebhookId) {
    res.status(400).json({ error: "Missing company webhook id." });
    return;
  }

  if (!["GET", "POST"].includes(req.method || "")) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const company = await loadCompanyByWebhookId(supabase, companyWebhookId);
    if (!company) {
      res.status(404).json({ error: "Webhook not found." });
      return;
    }

    const body = parseBody(req);
    const providedSecret =
      safeStr(req.query?.secret) ||
      safeStr(req.headers?.["x-webhook-secret"]) ||
      safeStr(body?.secret) ||
      safeStr(body?.webhook_secret);

    if (!secretsMatch(company.lead_webhook_secret, providedSecret)) {
      res.status(401).json({ error: "Invalid webhook secret." });
      return;
    }

    if (req.method === "GET") {
      res.status(200).json({
        ok: true,
        ready: true,
        company_id: company.id,
        company_name: company.name || null,
      });
      return;
    }

    const lead = extractLeadFromPayload(body, {
      explicitSource:
        safeStr(req.query?.source) ||
        safeStr(body?.source) ||
        safeStr(body?.lead_source) ||
        safeStr(body?.platform_source) ||
        safeStr(body?.tool),
      status: safeStr(req.query?.status) || safeStr(body?.status),
    });

    if (!lead.first_name && !lead.last_name && !lead.company_name && !lead.email && !lead.phone) {
      res.status(400).json({
        error: "Could not find a usable lead name, company, email, or phone in the payload.",
        received_keys: lead.received_keys.slice(0, 25),
      });
      return;
    }

    const result = await upsertCustomerLead(supabase, company.id, lead, body);

    res.status(200).json({
      ok: true,
      action: result.action,
      customer_id: result.row?.id || null,
      customer_name: displayName(result.row) || null,
      pipeline_status: result.row?.pipeline_status || result.row?.status || null,
      matched_by: result.matchedBy,
    });
  } catch (err) {
    const msg = safeStr(err?.message) || "Server error";
    const lower = msg.toLowerCase();

    if (lower.includes("lead_webhook_id") || lower.includes("lead_webhook_secret")) {
      res.status(500).json({ error: "Webhook columns are missing. Run the customers_webhook_patch.sql file first." });
      return;
    }

    if (
      lower.includes("pipeline_status") ||
      lower.includes("lead_source") ||
      lower.includes("lead_notes") ||
      lower.includes("lead_payload") ||
      lower.includes("lead_external_id") ||
      lower.includes("lead_received_at")
    ) {
      res.status(500).json({ error: "Customer pipeline columns are missing. Run the customers_webhook_patch.sql file first." });
      return;
    }

    res.status(500).json({ error: msg });
  }
}

async function loadCompanyByWebhookId(supabase, webhookId) {
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, lead_webhook_id, lead_webhook_secret")
    .eq("lead_webhook_id", webhookId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function parseBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === "object") return raw;

  const text = String(raw || "").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    try {
      const params = new URLSearchParams(text);
      const out = {};
      for (const [k, v] of params.entries()) out[k] = v;
      return out;
    } catch {
      return {};
    }
  }
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function compactWhitespace(v) {
  return safeStr(v).replace(/\s+/g, " ");
}

function normalizeKey(key) {
  return safeStr(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeEmail(email) {
  const v = safeStr(email).toLowerCase();
  return v || "";
}

function normalizePhone(phone) {
  return compactWhitespace(phone);
}

function normalizeLeadSource(source) {
  const v = safeStr(source).toLowerCase();
  if (!v) return "";
  if (v.includes("zap")) return "zapier";
  if (v === "fb" || v.includes("facebook") || v.includes("instagram") || v.includes("meta")) return "meta";
  if (v.includes("make")) return "make";
  if (v.includes("web")) return "website";
  if (v.includes("phone") || v.includes("call")) return "phone";
  if (v.includes("refer")) return "referral";
  if (LEAD_SOURCES.has(v)) return v;
  return "other";
}

function normalizePipelineStatus(status) {
  const v = safeStr(status).toLowerCase();
  return PIPELINE_STATUSES.has(v) ? v : "new";
}

function secretsMatch(expected, provided) {
  const exp = Buffer.from(safeStr(expected), "utf8");
  if (!exp.length) return true;
  const got = Buffer.from(safeStr(provided), "utf8");
  if (!got.length || got.length !== exp.length) return false;
  return crypto.timingSafeEqual(exp, got);
}

function firstMeaningfulValue(value, depth = 0) {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return compactWhitespace(String(value));
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = firstMeaningfulValue(item, depth + 1);
      if (picked) return picked;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const key of ["value", "values", "text", "answer", "response", "label", "name"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const picked = firstMeaningfulValue(value[key], depth + 1);
        if (picked) return picked;
      }
    }
  }
  return "";
}

function buildCandidateMap(raw) {
  const map = new Map();
  const seen = new WeakSet();

  const addCandidate = (label, value) => {
    const key = normalizeKey(label);
    const picked = firstMeaningfulValue(value);
    if (!key || !picked) return;
    const existing = map.get(key) || { label: safeStr(label), values: [] };
    if (!existing.values.includes(picked)) existing.values.push(picked);
    if (!existing.label) existing.label = safeStr(label);
    map.set(key, existing);
  };

  const walk = (node, depth = 0) => {
    if (depth > 6 || node == null) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object") {
          const label =
            item.name ?? item.field ?? item.key ?? item.label ?? item.question ?? item.title ?? item.id;
          const value = item.value ?? item.values ?? item.answer ?? item.response ?? item.text;
          if (label != null && value != null) addCandidate(label, value);
        }
        walk(item, depth + 1);
      }
      return;
    }

    if (typeof node === "object") {
      if (seen.has(node)) return;
      seen.add(node);

      for (const [key, value] of Object.entries(node)) {
        if (value == null) continue;

        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          Array.isArray(value)
        ) {
          addCandidate(key, value);
        }

        if (typeof value === "object" || Array.isArray(value)) {
          walk(value, depth + 1);
        }
      }
    }
  };

  walk(raw);
  return map;
}

function splitPersonName(fullName) {
  const value = compactWhitespace(fullName);
  if (!value) return { first: "", last: "" };

  if (value.includes(",")) {
    const [last, first] = value.split(",").map((part) => compactWhitespace(part));
    return { first, last };
  }

  const parts = value.split(" ").filter(Boolean);
  if (parts.length <= 1) return { first: value, last: "" };
  return { first: parts.shift() || "", last: parts.join(" ") };
}

function looksLikeBusinessName(value) {
  const v = safeStr(value).toLowerCase();
  if (!v) return false;
  return /(llc|inc|ltd|corp|company|co\b|construction|contracting|roofing|renovation|builders|services)/i.test(v);
}

function pickExact(map, usedKeys, aliases) {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    const entry = map.get(key);
    if (entry?.values?.length) {
      usedKeys.add(key);
      return entry.values[0];
    }
  }
  return "";
}

function pickContains(map, usedKeys, fragments) {
  const needles = fragments.map((f) => normalizeKey(f)).filter(Boolean);
  for (const [key, entry] of map.entries()) {
    if (!entry?.values?.length) continue;
    if (needles.some((needle) => key.includes(needle))) {
      usedKeys.add(key);
      return entry.values[0];
    }
  }
  return "";
}

function buildAddress(parts) {
  const full = compactWhitespace(parts.full);
  if (full) return full;

  const line1 = [parts.address1, parts.address2].map(compactWhitespace).filter(Boolean).join(", ");
  const line2 = [parts.city, parts.state, parts.postal].map(compactWhitespace).filter(Boolean).join(", ");
  const line3 = compactWhitespace(parts.country);
  return [line1, line2, line3].filter(Boolean).join("\n");
}

function buildExtraFieldLines(map, usedKeys) {
  const ignore = new Set([
    ...usedKeys,
    "secret",
    "webhooksecret",
    "token",
    "accesstoken",
    "authorization",
    "apitoken",
    "apikey",
    "createdtime",
    "timestamp",
    "status",
    "source",
    "tool",
  ]);

  const lines = [];
  for (const [key, entry] of map.entries()) {
    if (ignore.has(key)) continue;
    const value = safeStr(entry?.values?.[0]);
    if (!value) continue;
    const label = safeStr(entry?.label) || key;
    if (label.toLowerCase() === "name") continue;
    lines.push(`${label}: ${value}`);
    if (lines.length >= 8) break;
  }
  return lines;
}

function extractLeadFromPayload(raw, opts = {}) {
  const map = buildCandidateMap(raw);
  const usedKeys = new Set();

  let firstName = pickExact(map, usedKeys, [
    "first_name",
    "firstname",
    "first name",
    "fname",
    "given_name",
    "given name",
  ]);

  let lastName = pickExact(map, usedKeys, [
    "last_name",
    "lastname",
    "last name",
    "lname",
    "family_name",
    "family name",
    "surname",
  ]);

  let fullName = pickExact(map, usedKeys, [
    "full_name",
    "fullname",
    "contact_name",
    "contactname",
    "customer_name",
    "customername",
    "lead_name",
    "leadname",
    "your_name",
    "yourname",
  ]);

  if (!fullName) {
    const genericName = pickExact(map, usedKeys, ["name"]);
    if (genericName && !looksLikeBusinessName(genericName)) {
      fullName = genericName;
    }
  }

  if ((!firstName && !lastName) && fullName) {
    const split = splitPersonName(fullName);
    firstName = firstName || split.first;
    lastName = lastName || split.last;
  }

  const companyName = pickExact(map, usedKeys, [
    "company_name",
    "companyname",
    "business_name",
    "businessname",
    "company",
    "business",
    "organization",
    "organisation",
    "org",
  ]);

  let email = pickExact(map, usedKeys, [
    "email",
    "email_address",
    "emailaddress",
    "contact_email",
    "contactemail",
    "your_email",
    "youremail",
  ]);
  if (!email) email = pickContains(map, usedKeys, ["email"]);

  let phone = pickExact(map, usedKeys, [
    "phone",
    "phone_number",
    "phonenumber",
    "mobile",
    "mobile_phone",
    "mobilephone",
    "cell",
    "cellphone",
    "telephone",
    "contact_phone",
    "contactphone",
    "your_phone",
    "yourphone",
  ]);
  if (!phone) phone = pickContains(map, usedKeys, ["phone", "mobile", "cell", "tel"]);

  const address = buildAddress({
    full: pickExact(map, usedKeys, ["address", "full_address", "fulladdress", "street_address", "streetaddress", "service_address", "serviceaddress", "billing_address", "billingaddress"]),
    address1: pickExact(map, usedKeys, ["address1", "street", "street1", "address_line_1", "addressline1", "line1"]),
    address2: pickExact(map, usedKeys, ["address2", "unit", "suite", "apt", "apartment", "address_line_2", "addressline2", "line2"]),
    city: pickExact(map, usedKeys, ["city", "town"]),
    state: pickExact(map, usedKeys, ["state", "province", "region"]),
    postal: pickExact(map, usedKeys, ["postal_code", "postalcode", "postcode", "zip_code", "zipcode", "zip"]),
    country: pickExact(map, usedKeys, ["country"]),
  });

  const explicitNotes = pickExact(map, usedKeys, [
    "notes",
    "note",
    "message",
    "comments",
    "comment",
    "details",
    "description",
    "project_details",
    "projectdetails",
    "project_description",
    "projectdescription",
    "additional_info",
    "additionalinfo",
    "additional_information",
    "additionalinformation",
    "service_needed",
    "serviceneeded",
    "services_needed",
    "servicesneeded",
    "request",
    "lead_notes",
    "leadnotes",
  ]);

  const requestedService = pickExact(map, usedKeys, [
    "service",
    "service_type",
    "servicetype",
    "requested_service",
    "requestedservice",
    "project_type",
    "projecttype",
  ]);

  const campaignName = pickExact(map, usedKeys, ["campaign_name", "campaignname", "campaign"]);
  const adName = pickExact(map, usedKeys, ["ad_name", "adname"]);
  const formName = pickExact(map, usedKeys, ["form_name", "formname", "lead_form_name", "leadformname"]);
  const pageName = pickExact(map, usedKeys, ["page_name", "pagename", "page"]);
  const externalLeadId = pickExact(map, usedKeys, [
    "meta_lead_id",
    "metaleadid",
    "facebook_lead_id",
    "facebookleadid",
    "leadgen_id",
    "leadgenid",
    "lead_id",
    "leadid",
  ]);

  const transport = normalizeLeadSource(opts.explicitSource);
  const metaHints = Boolean(
    externalLeadId || campaignName || adName || formName || pageName || map.has("leadgenid") || map.has("metaleadid") || map.has("facebookleadid")
  );

  const source = metaHints ? "meta" : (transport || "other");
  const viaTool = transport === "make" || transport === "zapier" ? transport : "";

  const noteParts = [];
  if (explicitNotes) noteParts.push(explicitNotes);

  const contextLines = [];
  if (source === "meta") {
    contextLines.push(`Received from Meta lead form${viaTool ? ` via ${viaTool === "make" ? "Make" : "Zapier"}` : ""}.`);
  } else if (viaTool) {
    contextLines.push(`Received via ${viaTool === "make" ? "Make" : "Zapier"}.`);
  }
  if (requestedService) contextLines.push(`Service requested: ${requestedService}`);
  if (campaignName) contextLines.push(`Campaign: ${campaignName}`);
  if (adName) contextLines.push(`Ad: ${adName}`);
  if (formName) contextLines.push(`Form: ${formName}`);
  if (pageName) contextLines.push(`Page: ${pageName}`);
  if (contextLines.length) noteParts.push(contextLines.join("\n"));

  const extraLines = buildExtraFieldLines(map, usedKeys);
  if (extraLines.length) noteParts.push(extraLines.join("\n"));

  return {
    first_name: compactWhitespace(firstName),
    last_name: compactWhitespace(lastName),
    company_name: compactWhitespace(companyName),
    email: normalizeEmail(email),
    phone: normalizePhone(phone),
    address,
    notes: noteParts.filter(Boolean).join("\n\n").slice(0, 4000),
    source,
    status: normalizePipelineStatus(opts.status),
    externalLeadId: compactWhitespace(externalLeadId),
    received_keys: Array.from(map.keys()),
  };
}

function sanitizePayloadForStorage(value, depth = 0) {
  if (depth > 6 || value == null) return null;

  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizePayloadForStorage(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, 100);
    for (const [key, v] of entries) {
      const nk = normalizeKey(key);
      if (["secret", "token", "accesstoken", "authorization", "apikey", "password"].some((frag) => nk.includes(frag))) {
        continue;
      }
      out[key] = sanitizePayloadForStorage(v, depth + 1);
    }
    return out;
  }

  return null;
}

function mergeNotes(existing, incoming) {
  const a = safeStr(existing);
  const b = safeStr(incoming);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n\n${b}`.slice(0, 8000);
}

function chooseSource(existing, incoming) {
  const a = normalizeLeadSource(existing);
  const b = normalizeLeadSource(incoming);
  if (!a) return b || null;
  if (!b) return a;
  if (a === "manual" && b !== "manual") return b;
  if (a === "other" && b !== "other") return b;
  return a;
}

function chooseStatus(existing, incoming) {
  const a = normalizePipelineStatus(existing);
  const b = normalizePipelineStatus(incoming);
  if (!a) return b;
  if (["won", "lost"].includes(a)) return a;

  const rank = { new: 0, contacted: 1, qualified: 2, won: 3, lost: 3 };
  return rank[b] > rank[a] ? b : a;
}

function displayName(row) {
  const first = safeStr(row?.first_name);
  const last = safeStr(row?.last_name);
  return `${first} ${last}`.trim() || safeStr(row?.company_name) || safeStr(row?.email);
}

async function maybeFindByExternalId(supabase, companyId, externalLeadId) {
  if (!externalLeadId) return null;
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("company_id", companyId)
      .eq("lead_external_id", externalLeadId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (err) {
    const msg = safeStr(err?.message).toLowerCase();
    if (msg.includes("lead_external_id") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("not found"))) {
      return null;
    }
    throw err;
  }
}

async function maybeFindByEmail(supabase, companyId, email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", companyId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function maybeFindByPhone(supabase, companyId, phone) {
  if (!phone) return null;
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", companyId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function insertCustomerRow(supabase, row) {
  try {
    const { data, error } = await supabase.from("customers").insert(row).select("*").single();
    if (error) throw error;
    return data;
  } catch (err) {
    const msg = safeStr(err?.message).toLowerCase();
    if (msg.includes("lead_payload") || msg.includes("lead_external_id") || msg.includes("lead_received_at")) {
      const fallback = { ...row };
      delete fallback.lead_payload;
      delete fallback.lead_external_id;
      delete fallback.lead_received_at;
      const { data, error } = await supabase.from("customers").insert(fallback).select("*").single();
      if (error) throw error;
      return data;
    }
    throw err;
  }
}

async function updateCustomerRow(supabase, id, updates) {
  try {
    const { data, error } = await supabase.from("customers").update(updates).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  } catch (err) {
    const msg = safeStr(err?.message).toLowerCase();
    if (msg.includes("lead_payload") || msg.includes("lead_external_id") || msg.includes("lead_received_at")) {
      const fallback = { ...updates };
      delete fallback.lead_payload;
      delete fallback.lead_external_id;
      delete fallback.lead_received_at;
      const { data, error } = await supabase.from("customers").update(fallback).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    }
    throw err;
  }
}

async function upsertCustomerLead(supabase, companyId, lead, rawBody) {
  const now = new Date().toISOString();
  const payloadJson = sanitizePayloadForStorage(rawBody);

  let existing = null;
  let matchedBy = "none";

  existing = await maybeFindByExternalId(supabase, companyId, lead.externalLeadId);
  if (existing) matchedBy = "external_id";

  if (!existing) {
    existing = await maybeFindByEmail(supabase, companyId, lead.email);
    if (existing) matchedBy = "email";
  }

  if (!existing) {
    existing = await maybeFindByPhone(supabase, companyId, lead.phone);
    if (existing) matchedBy = "phone";
  }

  if (!existing) {
    const row = await insertCustomerRow(supabase, {
      company_id: companyId,
      first_name: lead.first_name || null,
      last_name: lead.last_name || null,
      company_name: lead.company_name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      billing_address: lead.address || null,
      pipeline_status: lead.status || "new",
      lead_source: lead.source || "meta",
      lead_notes: lead.notes || null,
      lead_external_id: lead.externalLeadId || null,
      lead_payload: payloadJson,
      lead_received_at: now,
      updated_at: now,
    });

    return { action: "created", row, matchedBy };
  }

  const updates = {
    first_name: safeStr(existing.first_name) || lead.first_name || null,
    last_name: safeStr(existing.last_name) || lead.last_name || null,
    company_name: safeStr(existing.company_name) || lead.company_name || null,
    email: safeStr(existing.email) || lead.email || null,
    phone: safeStr(existing.phone) || lead.phone || null,
    billing_address: safeStr(existing.billing_address) || lead.address || null,
    pipeline_status: chooseStatus(existing.pipeline_status, lead.status),
    lead_source: chooseSource(existing.lead_source, lead.source),
    lead_notes: mergeNotes(existing.lead_notes, lead.notes),
    lead_external_id: safeStr(existing.lead_external_id) || lead.externalLeadId || null,
    lead_payload: payloadJson,
    lead_received_at: existing.lead_received_at || now,
    updated_at: now,
  };

  const row = await updateCustomerRow(supabase, existing.id, updates);
  return { action: "updated", row, matchedBy };
}
