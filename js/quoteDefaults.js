export const DEFAULT_COMPANY = {
  name: "Endura Metal Roofing Ltd.",
  addr1: "230 Spencer Ave",
  addr2: "Thornton",
  phone: "705-903-7663",
  email: "jacob@endurametalroofing.ca",
  web: "endurametalroofing.ca",
};

export const DEFAULT_REP = {
  name: "Jacob Docherty",
};

export const DEFAULT_TERMS = `PAYMENT SCHEDULE
• 40% deposit due upon acceptance (invoice issued immediately).
• 40% due at start of install.
• 20% due upon substantial completion.

GENERAL TERMS & CONDITIONS
• Quote valid for 30 days. Scheduling is weather-dependent.
• HST (13%) applies unless otherwise noted.
• Unforeseen conditions (e.g., rotten/soft decking, hidden damage, mold, asbestos, electrical or structural issues) are excluded. Any remediation or additional materials/labour will be billed as a change order at agreed rates.
• Unless specifically included, permits, engineering, and interior repairs are excluded.
• Owner to provide clear site access, power and water. We are not responsible for damage resulting from pre-existing conditions.
• Materials remain the property of Endura Metal Roofing Ltd. until paid in full. Late balances accrue interest at 2% per month (24% per annum) or the maximum permitted by law.
• Colour variations, minor oil-canning on steel panels, and manufacturer production variances are normal and not defects.
• We will install flashings/vents to industry best practices; tie-ins to existing structures beyond the defined scope may require additional work.
• Endura Metal Roofing Ltd. warrants workmanship for 10 years from completion when paid in full and maintained per manufacturer guidelines. All steel products include a 40-year paint warranty per manufacturer terms. Manufacturer warranties apply as provided and take precedence for product defects. Workmanship warranty is void if others alter the installation, if maintenance is neglected, or if damage results from storms or other external causes.
• Customer must report deficiencies in writing within 10 days of completion; we will address reasonable punch-list items promptly.

By signing, Client accepts this quote and the terms above.`;

function toISO(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function makeDefaultQuoteData({ customer_name = "", customer_email = "" } = {}) {
  const today = new Date();
  const expires = new Date(today);
  expires.setDate(today.getDate() + 30);

  return {
    company: { ...DEFAULT_COMPANY },
    meta: {
      quote_date: toISO(today),
      quote_expires: toISO(expires),
      prepared_by: DEFAULT_REP.name, // default estimator name
    },
    bill_to: {
      client_name: customer_name,
      client_phone: "",
      client_email: customer_email,
      client_addr: "",
    },
    project: {
      project_location: "",
    },
    scope: "",
    items: [{ description: "", qty: 1, unit_price_cents: 0, taxable: true }],
    tax_rate: 13,
    fees_cents: 0,
    deposit_mode: "auto",
    deposit_cents: 0,
    terms: DEFAULT_TERMS,
    notes: "",
  };
}

export function formatQuoteCode(quoteNo, quoteDateISO) {
  const year = quoteDateISO ? new Date(quoteDateISO).getFullYear() : new Date().getFullYear();
  return `ER-${year}-${String(quoteNo).padStart(4, "0")}`;
}