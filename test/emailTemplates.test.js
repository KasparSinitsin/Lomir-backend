const test = require("node:test");
const assert = require("node:assert/strict");

const mailProvider = require("../src/services/mailProvider");
const emailService = require("../src/services/emailService");
const { COPY, emailCopy, fill } = require("../src/services/emailCopy");
const { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } = require("../src/config/languages");

/**
 * Email is the only thing the backend translates, so these tests check the two
 * things that actually break: that a language reaches the template at all, and
 * that no template quietly ships English to a German reader.
 *
 * German is the informal "Du" (Julia, 2026-09-12), matching the app.
 */

const originalSend = mailProvider.send;
const originalLog = console.log;
let sent = [];

const withCapturedMail = async (fn) => {
  sent = [];
  mailProvider.send = async (payload) => {
    sent.push(payload);
    return { messageId: "test-message-id" };
  };
  console.log = () => {};
  try {
    await fn();
  } finally {
    mailProvider.send = originalSend;
    console.log = originalLog;
  }
  return sent;
};

process.env.FRONTEND_URL = process.env.FRONTEND_URL || "https://example.test";

test("every template defines exactly the same slots in both languages", () => {
  for (const [name, table] of Object.entries(COPY)) {
    for (const lang of SUPPORTED_LANGUAGES) {
      assert.ok(table[lang], `${name} has no ${lang} copy`);
    }
    const keys = SUPPORTED_LANGUAGES.map((l) => Object.keys(table[l]).sort().join(","));
    assert.equal(
      new Set(keys).size,
      1,
      `${name}: the languages define different slots — a template would render ` +
        `"undefined" in one of them`,
    );
  }
});

test("no German string is left in English", () => {
  // A cheap smoke test for copy-paste: if a de value is byte-identical to its
  // en counterpart it was almost certainly never translated. Proper nouns are
  // allowed through by the short-string exemption.
  const suspicious = [];
  for (const [name, table] of Object.entries(COPY)) {
    for (const [slot, en] of Object.entries(table.en)) {
      const de = table.de[slot];
      if (de === en && String(en).split(/\s+/).length > 2) {
        suspicious.push(`${name}.${slot}`);
      }
    }
  }
  assert.deepEqual(suspicious, [], `untranslated German slots: ${suspicious.join(", ")}`);
});

test("an unsupported language falls back rather than throwing", () => {
  assert.equal(emailCopy("verification", "fr").subject, COPY.verification.en.subject);
  assert.equal(emailCopy("verification", null).subject, COPY.verification[DEFAULT_LANGUAGE].subject);
  assert.equal(emailCopy("verification", undefined).subject, COPY.verification.en.subject);
});

test("fill leaves an unknown slot visible instead of printing undefined", () => {
  assert.equal(fill("Hi {nope}", {}), "Hi {nope}");
  assert.equal(fill("Hi {name}", { name: "Anna" }), "Hi Anna");
});

test("the verification mail renders German for de and English for en", async () => {
  const de = await withCapturedMail(() =>
    emailService.sendVerificationEmail("a@b.test", "tok", "Anna", "de"),
  );
  assert.equal(de.length, 1);
  assert.equal(de[0].subject, "Bestätige deinen Lomir-Account");
  assert.match(de[0].html, /Willkommen bei Lomir, Anna!/);
  assert.match(de[0].html, /E-Mail-Adresse bestätigen/);
  assert.match(de[0].html, /Account-Einstellungen/);
  assert.doesNotMatch(de[0].html, /Thanks for signing up/);

  const en = await withCapturedMail(() =>
    emailService.sendVerificationEmail("a@b.test", "tok", "Anna", "en"),
  );
  assert.equal(en[0].subject, "Verify your Lomir account");
  assert.match(en[0].html, /Welcome to Lomir, Anna!/);
});

test("all five templates render in both languages with the token link intact", async () => {
  const cases = [
    ["sendVerificationEmail", ["a@b.test", "tok123", "Anna"], /tok123/],
    ["sendPasswordResetEmail", ["a@b.test", "tok123", "Anna"], /tok123/],
    ["sendEmailChangeVerificationEmail", ["a@b.test", "tok123", "Anna"], /tok123/],
    ["sendPasswordChangedEmail", ["a@b.test", "Anna"], /forgot-password/],
    ["sendReportReceiptEmail", ["Anna", "a@b.test", "REF-42"], /REF-42/],
  ];
  for (const [fn, args, mustContain] of cases) {
    for (const lang of SUPPORTED_LANGUAGES) {
      const out = await withCapturedMail(() => emailService[fn](...args, lang));
      assert.equal(out.length, 1, `${fn}/${lang} sent ${out.length} mails`);
      assert.ok(out[0].subject, `${fn}/${lang} has no subject`);
      assert.match(out[0].html, mustContain, `${fn}/${lang} lost its link or reference`);
      assert.doesNotMatch(
        out[0].html,
        /undefined|\{\w+\}/,
        `${fn}/${lang} rendered an unfilled slot`,
      );
    }
  }
});

test("the username is HTML-escaped in every template that prints it", async () => {
  const evil = '<img src=x onerror="alert(1)">';
  const cases = [
    ["sendVerificationEmail", ["a@b.test", "tok", evil]],
    ["sendPasswordResetEmail", ["a@b.test", "tok", evil]],
    ["sendEmailChangeVerificationEmail", ["a@b.test", "tok", evil]],
    ["sendPasswordChangedEmail", ["a@b.test", evil]],
    ["sendReportReceiptEmail", [evil, "a@b.test", "REF-1"]],
  ];
  for (const [fn, args] of cases) {
    const out = await withCapturedMail(() => emailService[fn](...args, "de"));
    assert.doesNotMatch(
      out[0].html,
      /<img src=x/,
      `${fn}: an unescaped name reached the HTML — this was live for the ` +
        `verification and password-reset mails until 2026-09-12`,
    );
    assert.match(out[0].html, /&lt;img/, `${fn}: name not escaped`);
  }
});

test("the report receipt keeps the reference code out of the header raw", async () => {
  const out = await withCapturedMail(() =>
    emailService.sendReportReceiptEmail("Anna", "a@b.test", "REF\r\nBcc: evil@x", "de"),
  );
  assert.doesNotMatch(out[0].subject, /[\r\n]/, "header injection via reference code");
});
