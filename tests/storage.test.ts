import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace,
  parseWorkspace,
  loadWorkspace,
  saveWorkspace,
} from "../src/lib/storage.ts";
import { generatePack } from "../src/lib/engine.ts";

test("backup round-trip keeps event details and estimate", () => {
  const workspace = createWorkspace();
  workspace.brief.name = "Edited event";
  workspace.baselineMinutes = 83;
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});
test("malformed, oversized and unexpected backups are rejected", () => {
  for (const json of ["{bad", "{}", '{"version":2}', " ".repeat(1_000_001)])
    assert.throws(() => parseWorkspace(json));
  const w = createWorkspace();
  w.brief.capacity = NaN;
  assert.throws(() => parseWorkspace(JSON.stringify(w)));
});
test("corrupt storage is unknown, never an empty saved workspace", () => {
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "{broken", setItem: () => writes++ },
  });
  const result = loadWorkspace();
  assert.equal(result.workspace, null);
  assert.ok(result.error);
  assert.equal(writes, 0);
});
test("storage quota failure is surfaced to the caller", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error("quota");
      },
    },
  });
  assert.throws(() => saveWorkspace(createWorkspace()), /could not be saved/);
});
test("backup approval status must be a string enum, not a coercible array", () => {
  const w = createWorkspace();
  w.pack = generatePack(w.brief);
  const unsafe = JSON.parse(JSON.stringify(w));
  unsafe.pack.assets[0].status = ["approved"];
  assert.throws(() => parseWorkspace(JSON.stringify(unsafe)));
});
