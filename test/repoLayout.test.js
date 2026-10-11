const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The repository is public, so its layout is part of how it looks. Every script
// lives in scripts/; the root holds configuration only. This test keeps it so:
// a new script dropped in the root, or an `npm run` entry that points at one,
// fails here instead of being noticed in a review.

const root = path.join(__dirname, "..");
const SCRIPT_EXTENSIONS = /\.(js|mjs|cjs|ts|sh|sql|py)$/;

// Root files that are code by extension but configuration by purpose.
// Add a name here only for a tool that insists on a file in the root.
const ALLOWED_IN_ROOT = [];

test("the repository root holds no script", () => {
  const strays = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCRIPT_EXTENSIONS.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !ALLOWED_IN_ROOT.includes(name));

  assert.deepEqual(
    strays,
    [],
    `scripts belong in scripts/, not in the root: ${strays.join(", ")}`,
  );
});

// The file a `node ...` or `./...sh` command in package.json runs.
const targetsOf = (command) => {
  const found = [];
  for (const part of command.split(/&&|\|\||;/)) {
    const words = part.trim().split(/\s+/);
    const at = words.findIndex((w) => w === "node" || w === "nodemon");
    if (at !== -1) {
      const target = words.slice(at + 1).find((w) => !w.startsWith("-"));
      if (target) found.push(target);
    }
    for (const w of words) {
      if (/^\.\/.+\.sh$/.test(w)) found.push(w.replace(/^\.\//, ""));
    }
  }
  return found;
};

test("every npm run entry points at a file in scripts/ or src/", () => {
  const { scripts } = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const checked = [];

  for (const [name, command] of Object.entries(scripts)) {
    for (const target of targetsOf(command)) {
      checked.push(`${name} -> ${target}`);
      assert.ok(
        target.startsWith("scripts/") || target.startsWith("src/"),
        `"${name}" runs ${target}: scripts belong in scripts/`,
      );
      assert.ok(
        fs.existsSync(path.join(root, target)),
        `"${name}" runs ${target}, which does not exist`,
      );
    }
  }

  // The test must have looked at something, or it proves nothing.
  assert.ok(checked.length >= 5, `only ${checked.length} entries checked`);
});

test("the entry point that moved is where package.json says", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts", "migrate.js")));
  assert.ok(!fs.existsSync(path.join(root, "migrate.js")), "migrate.js is back in the root");
});
