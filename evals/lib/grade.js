function valuesEqual(expected, actual) {
    if (Array.isArray(expected) || Array.isArray(actual)) {
        return JSON.stringify(expected) === JSON.stringify(actual);
    }

    return expected === actual;
}

function compareField(mode, expected, actual) {
    if (mode === "ignore") {
        return true;
    }

    if (mode === "numeric") {
        const expectedNumber = Number(expected);
        const actualNumber = Number(actual);
        return Number.isFinite(expectedNumber)
            && Number.isFinite(actualNumber)
            && Math.abs(expectedNumber - actualNumber) < 0.01;
    }

    if (mode === "set") {
        if (!Array.isArray(expected) || !Array.isArray(actual)) {
            return false;
        }

        const expectedSet = new Set(expected);
        const actualSet = new Set(actual);
        return expectedSet.size === actualSet.size
            && [...expectedSet].every(value => actualSet.has(value));
    }

    return valuesEqual(expected, actual);
}

/**
 * Compares two arrays of records keyed by `keyField`, independent of order.
 * `fields` maps field name -> "exact" | "numeric" | "set" | "ignore".
 */
export function gradeKeyedArray(actual, expected, { keyField, fields }) {
    const issues = [];

    if (!Array.isArray(actual)) {
        return {
            passed: false,
            issues: [{ type: "not_an_array", detail: `Expected an array, got ${typeof actual}` }]
        };
    }

    const actualByKey = new Map(actual.map(record => [record?.[keyField], record]));
    const expectedByKey = new Map(expected.map(record => [record[keyField], record]));

    for (const key of expectedByKey.keys()) {
        if (!actualByKey.has(key)) {
            issues.push({ type: "missing_record", key });
        }
    }

    for (const key of actualByKey.keys()) {
        if (!expectedByKey.has(key)) {
            issues.push({ type: "unexpected_record", key });
        }
    }

    for (const [key, expectedRecord] of expectedByKey) {
        const actualRecord = actualByKey.get(key);

        if (!actualRecord) {
            continue;
        }

        for (const [field, mode] of Object.entries(fields)) {
            if (!compareField(mode, expectedRecord[field], actualRecord[field])) {
                issues.push({
                    type: "field_mismatch",
                    key,
                    field,
                    expected: expectedRecord[field],
                    actual: actualRecord[field]
                });
            }
        }
    }

    return { passed: issues.length === 0, issues };
}
