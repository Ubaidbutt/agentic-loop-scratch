import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "fixtures",
    "vendor-invoices-payables"
);

export default {
    id: "vendor-invoices-payables",
    description: "Splits messy vendor invoices into a per-vendor payables report and a "
        + "rejected-records file, from an intentionally underspecified prompt that "
        + "requires the agent to ask clarifying questions.",
    fixturesDir,
    promptFile: "prompt.txt",
    policyFile: "policy.md",
    inputFiles: ["messy_vendor_invoices.json"],
    expectedOutputs: [
        {
            filename: "vendor_payables_report.json",
            expectedFile: "expected/vendor_payables_report.json",
            keyField: "vendor_id",
            fields: {
                vendor_name: "exact",
                invoice_count: "exact",
                open_invoice_count: "exact",
                paid_invoice_count: "exact",
                credit_memo_count: "exact",
                late_invoice_count: "exact",
                total_usd: "numeric",
                max_days_late: "exact",
                review_flag: "exact",
                included_record_ids: "set"
            }
        },
        {
            filename: "rejected_vendor_invoices.json",
            expectedFile: "expected/rejected_vendor_invoices.json",
            keyField: "record_id",
            fields: {
                reason: "exact"
            }
        }
    ]
};
