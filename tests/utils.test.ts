import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeUrl,
  cleanText,
  constantTimeEqual,
  escapeHtml,
} from "../supabase/functions/_shared/utils.ts";

test("canonical URLs remove tracking and fragments", () => {
  assert.equal(
    canonicalizeUrl("https://Example.com/news/?utm_source=x&id=7#part"),
    "https://example.com/news?id=7",
  );
});

test("Docker security anchors can remain distinct", () => {
  assert.equal(
    canonicalizeUrl("https://docs.docker.com/security/security-announcements/#cve-1", undefined, {
      preserveHash: true,
    }),
    "https://docs.docker.com/security/security-announcements#cve-1",
  );
});

test("Telegram HTML is escaped", () => {
  assert.equal(escapeHtml('<A & "B">'), "&lt;A &amp; &quot;B&quot;&gt;");
});

test("feed HTML is cleaned", () => {
  assert.equal(cleanText("<p>Hello&nbsp;world</p>"), "Hello world");
});

test("secret comparison rejects different lengths and values", () => {
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("same", "different"), false);
  assert.equal(constantTimeEqual("same", "samf"), false);
});
