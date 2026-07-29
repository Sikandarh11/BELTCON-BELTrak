import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const documents = {
  conformance: new URL("../docs/testing/BELTCON-SBTS-BASELINE-CONFORMANCE-V1.md", import.meta.url),
  fat: new URL("../docs/testing/BELTCON-SBTS-FAT-V1.md", import.meta.url),
  sat: new URL("../docs/testing/BELTCON-SBTS-SAT-V1.md", import.meta.url),
  demo: new URL("../docs/demo/BELTCON-SBTS-DEMONSTRATION-RUNBOOK-V1.md", import.meta.url),
  architecture: new URL(
    "../docs/architecture/BELTCON-SBTS-FINAL-ARCHITECTURE-REVIEW-V1.md",
    import.meta.url,
  ),
  limitations: new URL("../docs/testing/BELTCON-SBTS-LIMITATION-REGISTER-V1.md", import.meta.url),
};

test("Phase 11 provides the required BELTCON conformance, acceptance, demo, architecture, and limitation documents", async () => {
  const entries = await Promise.all(
    Object.entries(documents).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  );
  const content = Object.fromEntries(entries);

  for (const document of Object.values(content)) {
    assert.match(document, /BELTCON SBTS/);
    assert.doesNotMatch(document, /trackit|al[ -]?wajh|beltrak/i);
  }
  assert.match(content.conformance, /SAT REQUIRED/);
  assert.match(content.fat, /NOT EXECUTED/);
  assert.match(content.sat, /NOT EXECUTED/);
  assert.match(content.demo, /Profinet communication/);
  assert.match(content.architecture, /No disposable database was available/);
  assert.match(content.limitations, /Migrations 001–023 were not applied/);
});
