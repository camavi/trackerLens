const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const appHtml = fs.readFileSync(path.join(projectRoot, "app.html"), "utf8");
const scriptPaths = [...appHtml.matchAll(/<script src="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((scriptPath) => scriptPath.split("?")[0].endsWith(".js"));

assert.ok(scriptPaths.length > 0, "app.html must load classic JavaScript scripts");

const source = scriptPaths
  .map((scriptPath) => fs.readFileSync(path.join(projectRoot, scriptPath.split("?")[0]), "utf8"))
  .join("\n;\n");

assert.doesNotThrow(
  () => new vm.Script(source, { filename: "app-classic-scripts.js" }),
  "classic scripts in app.html must share one valid global scope",
);

console.log(`Validated common scope for ${scriptPaths.length} app classic scripts.`);
