// js/quoteDefaults.js
// SaaS-safe defaults. IMPORTANT:
// - Do NOT hardcode company info or payment terms here.
// - Company letterhead + payment terms are snapshotted into each quote at creation time
//   from the logged-in user's Company Settings (see createQuote in js/quotesApi.js).

export const DEFAULT_COMPANY = {
  company_id: null,
  name: "",
  addr1: "",
  addr2: "",
  phone: "",
  email: "",
  web: "",
  logo_url: "",
  currency: "CAD",
};

export function formatQuoteCode(quoteNo) {
  const n = String(quoteNo ?? "").trim();
  if (!n) return "";
  return `Q-${n}`;
}

export function makeDefaultQuoteData({ customer_name = "", customer_email = "" } = {}) {
  return {
    company: { ...DEFAULT_COMPANY },

    meta: {
      quote_date: "", // filled on create if missing
      quote_expires: "", // filled on create if missing
      prepared_by: "", // filled in builder if missing
    },

    bill_to: {
      client_name: String(customer_name || ""),
      client_phone: "",
      client_email: String(customer_email || ""),
      client_addr: "",
    },

    project: {
      project_location: "",
    },

    // Each item matches the shape the builder expects
    items: [],

    // Money + calc
    tax_name: "Tax",
    tax_rate: 13,
    fees_cents: 0,

    // Deposit
    deposit_mode: "auto", // auto | custom
    deposit_cents: 0,

    // Snapshot per quote (do not pull live after creation)
    terms: "",
    notes: "",
  };
}
