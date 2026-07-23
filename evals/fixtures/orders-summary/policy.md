# Ground-truth policy: orders-summary

This case is intentionally unambiguous -- the initial prompt already contains
every rule needed. The agent should not need to ask anything, but if it does,
answer from this:

- Group order rows by `customer_id`.
- `customer_name` is the name associated with that `customer_id` (it's the
  same for every row belonging to a customer).
- `order_count` is the number of order rows for that customer.
- `total_amount` is the sum of that customer's `amount` values (after
  stripping the leading `$`), rounded to 2 decimal places.
- There is no invalid, missing, or malformed data in this file -- every row
  is well-formed and belongs to exactly one customer.
- The order of records in the output does not matter.

If asked something not covered above, just restate the relevant part of the
original instruction -- do not invent new rules.
