# Ground-truth policy: vendor-invoices-payables

This is the answer key behind `expected/vendor_payables_report.json` and
`expected/rejected_vendor_invoices.json`. It exists so an LLM can play the
role of "the user" and answer the agent's clarifying questions the same way
every run, making the eval a repeatable regression check instead of a
one-off.

- **Duplicates**: two records are duplicates if they share the same
  `vendor_id` and the same normalized `invoice_number` (trimmed and
  uppercased). Keep the one with the latest `updated_at`; reject the other(s)
  with reason `duplicate_superseded`.
- **vendor_id**: required. Blank/empty -> reject with reason
  `missing_vendor_id`.
- **invoice_number**: normalize by trimming and uppercasing. Blank after
  trimming -> reject with reason `missing_invoice_number`.
- **approved**: counts as approved only if the value is boolean `true` or the
  string `"yes"`. Anything else (e.g. `false`) -> reject with reason
  `not_approved`.
- **amount_cents**: must be numeric (an int, or a string containing only
  digits, e.g. `"120000"`). Non-numeric values like `"bad"` -> reject with
  reason `invalid_amount`.
- **currency / FX**: only USD, EUR, and GBP are supported, using this fixed
  offline FX table: USD = 1.00, EUR = 1.10, GBP = 1.30 (multiply the gross
  amount in that currency by the rate to get USD). Any other currency (e.g.
  JPY) -> reject with reason `unsupported_currency`.
- **invoice_date**: accept ISO format (`YYYY-MM-DD`) or US format
  (`MM/DD/YYYY`), but it must be a real calendar date. `2026-02-30` is
  invalid (February 2026 has 28 days) -> reject with reason `invalid_date`.
- **Money calculation**: gross amount = `amount_cents + tax_cents (treat
  missing/null as 0) - discount_cents (treat missing/null as 0)`, converted
  from cents to dollars, then converted to USD with the FX table above.
  Credit memos (`status: "credit"`) already carry a negative `amount_cents`
  in the source data, so include them in the vendor total with no extra sign
  flip.
- **Lateness**:
  - `status: "paid"`: late if `paid_at`'s calendar date is after `due_date`;
    `late_days = paid_at_date - due_date`.
  - `status: "open"`: evaluate lateness as of **2026-03-01** (the report's
    as-of/reference date); late if `due_date` is before 2026-03-01;
    `late_days = 2026-03-01 - due_date`.
  - `status: "credit"` records are never evaluated for lateness.
  - A vendor's `max_days_late` is the largest `late_days` among its own late
    invoices (0 if none).
  - `late_invoice_count` counts paid/open invoices (not credit memos) with
    `late_days > 0`.
- **review_flag**: `true` if the vendor has at least one late invoice
  (`late_invoice_count > 0`), otherwise `false`.
- **Report fields per vendor**: `invoice_count` (all included records for
  that vendor, including credit memos), `open_invoice_count`,
  `paid_invoice_count`, `credit_memo_count`, `late_invoice_count`,
  `total_usd` (sum of each included record's USD gross, rounded to 2
  decimals), `max_days_late`, `review_flag`, `included_record_ids`.
- Every source record ends up in exactly one place: included in one vendor's
  totals, or rejected with exactly one reason. Never both, never neither.
- **Rejection reason codes to use verbatim**: `missing_vendor_id`,
  `missing_invoice_number`, `not_approved`, `invalid_amount`,
  `unsupported_currency`, `invalid_date`, `duplicate_superseded`. The
  `detail` field should be a short, specific, human-readable explanation of
  that particular record's problem, not a copy of the reason code.
- **Ordering**: the order of rows in either output file does not matter for
  grading. If asked, say any consistent order is fine.

If the agent asks something not explicitly covered above, infer the single
most reasonable answer that stays consistent with the rest of this policy —
do not refuse to answer.
