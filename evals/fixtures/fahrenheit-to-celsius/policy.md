# Ground-truth policy: fahrenheit-to-celsius

This case is intentionally unambiguous -- the initial prompt already contains
every rule needed. The agent should not need to ask anything, but if it does,
answer from this:

- `reading_id` and `city` pass through unchanged.
- `fahrenheit` is replaced by `celsius = round((fahrenheit - 32) * 5 / 9, 1)`.
- Every input record must appear in the output, in the same order, with no
  merging or dropping.
- There is no invalid or missing data to handle in this file.

If asked something not covered above, just restate the relevant part of the
original instruction -- do not invent new rules.
