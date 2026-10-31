/**
 * Tests for admin-editable site settings (lib/domain/siteSettings.ts):
 * resolution order admin value → env var → default, clearing, validation.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-site-settings.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-site-settings.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { getSiteSettingsWithSources, saveSiteSettings } from "@/lib/domain/siteSettings";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

// getSiteSettingsWithSources is wrapped in React cache(), which is a no-op
// outside a request, so every call below reads fresh values.

async function main() {
  delete process.env.SITE_CONTACT_EMAIL;
  delete process.env.SITE_OPERATOR_NAME;

  await test("defaults apply and operator facts start empty", async () => {
    const { values, sources, missingRequired } = await getSiteSettingsWithSources();
    assert.equal(values.serviceName, "올인픽");
    assert.equal(sources.serviceName, "default");
    assert.equal(values.contactEmail, null);
    assert.equal(sources.contactEmail, "none");
    assert.deepEqual(
      missingRequired.map((f) => f.key).sort(),
      ["contactEmail", "operatorName", "privacyOfficerName"].sort()
    );
  });

  await test("env var fills a value when no admin value is saved", async () => {
    process.env.SITE_CONTACT_EMAIL = "env@example.com";
    const { values, sources } = await getSiteSettingsWithSources();
    assert.equal(values.contactEmail, "env@example.com");
    assert.equal(sources.contactEmail, "env");
  });

  await test("admin value wins over env var", async () => {
    assert.deepEqual(await saveSiteSettings({ contactEmail: "admin@example.com", operatorName: "  홍길동   상점 " }), {});
    const { values, sources } = await getSiteSettingsWithSources();
    assert.equal(values.contactEmail, "admin@example.com");
    assert.equal(sources.contactEmail, "admin");
    assert.equal(values.operatorName, "홍길동 상점", "single-line values collapse whitespace");
  });

  await test("clearing an admin value falls back to env, then default", async () => {
    await saveSiteSettings({ contactEmail: "", serviceName: "새이름" });
    let s = await getSiteSettingsWithSources();
    assert.equal(s.values.contactEmail, "env@example.com");
    assert.equal(s.values.serviceName, "새이름");
    await saveSiteSettings({ serviceName: "   " });
    s = await getSiteSettingsWithSources();
    assert.equal(s.values.serviceName, "올인픽");
    assert.equal(s.sources.serviceName, "default");
  });

  await test("multiline notices keep their line breaks", async () => {
    await saveSiteSettings({ priceDisclaimer: "첫 줄\n둘째 줄" });
    assert.equal((await getSiteSettingsWithSources()).values.priceDisclaimer, "첫 줄\n둘째 줄");
  });

  await test("fields not in the form are left untouched", async () => {
    await saveSiteSettings({ privacyOfficerName: "김책임" });
    const { values } = await getSiteSettingsWithSources();
    assert.equal(values.operatorName, "홍길동 상점");
    assert.equal(values.privacyOfficerName, "김책임");
  });

  await test("invalid email and too-long values are rejected without saving anything", async () => {
    const bad = await saveSiteSettings({ operatorName: "바뀌면 안 됨", contactEmail: "not-an-email" });
    assert.match(bad.error ?? "", /문의 이메일/);
    const long = await saveSiteSettings({ serviceName: "가".repeat(51) });
    assert.match(long.error ?? "", /50자/);
    const { values } = await getSiteSettingsWithSources();
    assert.equal(values.operatorName, "홍길동 상점");
    assert.equal(values.serviceName, "올인픽");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
