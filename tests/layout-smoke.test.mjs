import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/css/toolbar.css", import.meta.url), "utf8");
assert.match(css, /overflow-x:\s*auto/);
assert.match(css, /max-width/);
assert.match(css, /mobile-modifier-bar/);
assert.doesNotMatch(css, /floating-more-button/);
console.log("Layout CSS smoke test passed.");
