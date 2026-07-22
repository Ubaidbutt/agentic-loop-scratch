const MAX_DEPENDENCIES = 20;
const MAX_DEPENDENCY_LENGTH = 200;

// Common standard-library names that are often mistakenly declared as packages.
const STANDARD_LIBRARY_NAMES = new Set([
    "argparse", "asyncio", "base64", "collections", "concurrent", "csv",
    "datetime", "decimal", "email", "enum", "functools", "glob", "gzip",
    "hashlib", "http", "importlib", "inspect", "io", "itertools", "json",
    "logging", "math", "multiprocessing", "os", "pathlib", "pickle",
    "random", "re", "shutil", "sqlite3", "statistics", "string",
    "subprocess", "sys", "tempfile", "time", "typing", "unittest",
    "urllib", "uuid", "xml", "zipfile"
]);

// Only accept a small, auditable subset of PEP 508: name, optional extras,
// and an optional exact version. The runtime normally chooses compatible
// versions. URLs, paths, flags, markers, and version ranges are excluded.
const DEPENDENCY_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*\])?(?:==([A-Za-z0-9][A-Za-z0-9.!+_-]*))?$/;

function canonicalizePackageName(name) {
    return name.toLowerCase().replaceAll(/[._-]+/g, "-");
}

export function validateExternalDependencies(externalDependencies) {
    if (!Array.isArray(externalDependencies)) {
        throw new Error("externalDependencies must be an array.");
    }

    if (externalDependencies.length > MAX_DEPENDENCIES) {
        throw new Error(`At most ${MAX_DEPENDENCIES} external dependencies are allowed.`);
    }

    const normalized = [];
    const packageNames = new Set();

    for (const dependency of externalDependencies) {
        if (typeof dependency !== "string" || dependency.length > MAX_DEPENDENCY_LENGTH) {
            throw new Error(
                `Each external dependency must be a string no longer than ${MAX_DEPENDENCY_LENGTH} characters.`
            );
        }

        const match = dependency.match(DEPENDENCY_PATTERN);

        if (!match) {
            throw new Error(
                `Invalid external dependency "${dependency}". Use a package name such as pandas or an exact pin such as pandas==2.3.1; URLs, paths, flags, markers, and version ranges are not allowed.`
            );
        }

        const [, rawName, extras = "", version] = match;
        const packageName = canonicalizePackageName(rawName);

        if (STANDARD_LIBRARY_NAMES.has(packageName)) {
            throw new Error(
                `"${rawName}" is part of the Python standard library and must not be listed as an external dependency.`
            );
        }

        if (packageNames.has(packageName)) {
            throw new Error(`External dependency "${rawName}" was declared more than once.`);
        }

        packageNames.add(packageName);
        normalized.push(
            `${packageName}${extras.toLowerCase()}${version ? `==${version}` : ""}`
        );
    }

    return normalized.sort();
}
