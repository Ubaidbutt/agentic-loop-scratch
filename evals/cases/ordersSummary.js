import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "fixtures",
    "orders-summary"
);

export default {
    id: "orders-summary",
    description: "Medium case: CSV input, light string cleanup (stripping a '$' prefix), "
        + "and a group-by-sum aggregation into a single JSON output. Fully specified in "
        + "the prompt (no ambiguity, no validation/rejection logic) -- a step up from the "
        + "simple case without the heavy ambiguity of the vendor-invoices-payables case.",
    fixturesDir,
    promptFile: "prompt.txt",
    policyFile: "policy.md",
    inputFiles: ["orders.csv"],
    expectedOutputs: [
        {
            filename: "customer_order_summary.json",
            expectedFile: "expected/customer_order_summary.json",
            keyField: "customer_id",
            fields: {
                customer_name: "exact",
                order_count: "exact",
                total_amount: "numeric"
            }
        }
    ]
};
