const test = require("node:test");
const assert = require("node:assert/strict");

const contactController = require("../src/controllers/contactController");
const contactReportModel = require("../src/models/contactReportModel");
const emailService = require("../src/services/emailService");

const REPORT_TOPIC = "Report content or abuse";

const originalCreateReport = contactReportModel.createReport;
const originalUpdateEmailStatus = contactReportModel.updateEmailStatus;
const originalSendContactFormEmail = emailService.sendContactFormEmail;
const originalSendReportReceiptEmail = emailService.sendReportReceiptEmail;
const originalTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;
const originalConsoleError = console.error;

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const createContactRequest = (overrides = {}) => ({
  body: {
    name: "Jane Reporter",
    email: "jane@example.com",
    topic: REPORT_TOPIC,
    message: "The team profile at /teams/42 contains abusive content.",
    ...overrides.body,
  },
  files:
    overrides.files === undefined
      ? [
          {
            originalname: "screenshot.png",
            mimetype: "image/png",
            size: 2048,
          },
        ]
      : overrides.files,
});

test.afterEach(() => {
  contactReportModel.createReport = originalCreateReport;
  contactReportModel.updateEmailStatus = originalUpdateEmailStatus;
  emailService.sendContactFormEmail = originalSendContactFormEmail;
  emailService.sendReportReceiptEmail = originalSendReportReceiptEmail;
  console.error = originalConsoleError;

  if (originalTurnstileSecret === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecret;
  }
});

test("submitContactForm persists abuse reports and returns a reference id", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const statusUpdates = [];

  contactReportModel.createReport = async (report) => {
    assert.equal(report.name, "Jane Reporter");
    assert.equal(report.email, "jane@example.com");
    assert.equal(report.topic, REPORT_TOPIC);
    assert.equal(report.message, "The team profile at /teams/42 contains abusive content.");
    assert.deepEqual(report.attachments, [
      {
        fileName: "screenshot.png",
        mimeType: "image/png",
        size: 2048,
      },
    ]);

    return {
      id: 12,
      reference_code: "RPT-20260616-ABCD1234",
    };
  };

  contactReportModel.updateEmailStatus = async (reportId, statusUpdate) => {
    statusUpdates.push({ reportId, statusUpdate });
    return { id: reportId, ...statusUpdate };
  };

  emailService.sendContactFormEmail = async (name, email, topic, message, files) => {
    assert.equal(name, "Jane Reporter");
    assert.equal(email, "jane@example.com");
    assert.equal(topic, "Report content or abuse (RPT-20260616-ABCD1234)");
    assert.equal(message, "The team profile at /teams/42 contains abusive content.");
    assert.equal(files.length, 1);
    return { success: true, messageId: "mail-123" };
  };

  const receiptCalls = [];
  emailService.sendReportReceiptEmail = async (name, email, referenceCode, language) => {
    receiptCalls.push({ name, email, referenceCode, language });
    return { success: true, messageId: "receipt-123" };
  };

  const res = createResponse();

  await contactController.submitContactForm(createContactRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.referenceId, "RPT-20260616-ABCD1234");
  assert.match(res.body.message, /RPT-20260616-ABCD1234/);
  assert.deepEqual(receiptCalls, [
    {
      name: "Jane Reporter",
      email: "jane@example.com",
      referenceCode: "RPT-20260616-ABCD1234",
      language: "en",
    },
  ]);
  assert.deepEqual(statusUpdates, [
    {
      reportId: 12,
      statusUpdate: {
        emailStatus: "sent",
        emailMessageId: "mail-123",
      },
    },
  ]);
});

test("submitContactForm keeps abuse reports received when email forwarding fails", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  console.error = () => {};

  const statusUpdates = [];

  contactReportModel.createReport = async () => ({
    id: 13,
    reference_code: "RPT-20260616-FAIL1234",
  });
  contactReportModel.updateEmailStatus = async (reportId, statusUpdate) => {
    statusUpdates.push({ reportId, statusUpdate });
    return { id: reportId, ...statusUpdate };
  };
  emailService.sendContactFormEmail = async () => ({ success: false });

  const res = createResponse();

  await contactController.submitContactForm(createContactRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.referenceId, "RPT-20260616-FAIL1234");
  assert.equal(statusUpdates.length, 1);
  assert.equal(statusUpdates[0].reportId, 13);
  assert.equal(statusUpdates[0].statusUpdate.emailStatus, "failed");
});

test("submitContactForm fails abuse reports when persistence fails", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  console.error = () => {};

  let emailCalled = false;

  contactReportModel.createReport = async () => {
    throw new Error("database unavailable");
  };
  contactReportModel.updateEmailStatus = async () => {
    throw new Error("updateEmailStatus should not be called");
  };
  emailService.sendContactFormEmail = async () => {
    emailCalled = true;
    return { success: true };
  };

  const res = createResponse();

  await contactController.submitContactForm(createContactRequest(), res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Failed to receive your report/);
  assert.equal(emailCalled, false);
});

test("submitContactForm leaves ordinary contact messages mail-only", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  let reportCalled = false;

  contactReportModel.createReport = async () => {
    reportCalled = true;
    throw new Error("createReport should not be called");
  };
  contactReportModel.updateEmailStatus = async () => {
    throw new Error("updateEmailStatus should not be called");
  };
  emailService.sendContactFormEmail = async () => ({ success: true });
  emailService.sendReportReceiptEmail = async () => {
    throw new Error("sendReportReceiptEmail should not be called");
  };

  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({
      body: {
        topic: "General question",
        message: "I have a general question.",
      },
      files: [],
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reportCalled, false);
  assert.equal(res.body.data, undefined);
});

test("submitContactForm still confirms the report when the receipt email fails", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  console.error = () => {};

  contactReportModel.createReport = async () => ({
    id: 14,
    reference_code: "RPT-20260616-RCPT0001",
  });
  contactReportModel.updateEmailStatus = async (reportId, statusUpdate) => ({
    id: reportId,
    ...statusUpdate,
  });
  emailService.sendContactFormEmail = async () => ({
    success: true,
    messageId: "mail-456",
  });
  emailService.sendReportReceiptEmail = async () => {
    throw new Error("receipt mailbox unavailable");
  };

  const res = createResponse();

  await contactController.submitContactForm(createContactRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.referenceId, "RPT-20260616-RCPT0001");
});

// The receipt language. `sendReportReceiptEmail` has taken a `language`
// argument since BE #321 and nobody passed one, so every reporter got an
// English acknowledgement — including one who had just filled in a German
// form. A report needs no account, so the language cannot be resolved from a
// user row; it travels with the request.

const captureReceiptLanguage = () => {
  const calls = [];
  contactReportModel.createReport = async () => ({
    id: 15,
    reference_code: "RPT-20260616-LANG0001",
  });
  contactReportModel.updateEmailStatus = async () => ({});
  emailService.sendContactFormEmail = async () => ({
    success: true,
    messageId: "mail-lang",
  });
  emailService.sendReportReceiptEmail = async (name, email, referenceCode, language) => {
    calls.push(language);
    return { success: true, messageId: "receipt-lang" };
  };
  return calls;
};

test("submitContactForm sends the report receipt in the language the form was filed in", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const languages = captureReceiptLanguage();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { language: "de" } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(languages, ["de"]);
});

test("submitContactForm falls back to English when no language is sent", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const languages = captureReceiptLanguage();
  const res = createResponse();

  await contactController.submitContactForm(createContactRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(languages, ["en"]);
});

test("submitContactForm accepts a report whose language is unsupported", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const languages = captureReceiptLanguage();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { language: "fr" } }),
    res,
  );

  // The point of the loose Joi rule: an unexpected code costs the reporter a
  // German acknowledgement, never the report itself. A `.valid(...)` rule here
  // would answer 400 and drop an abuse report on the floor.
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.referenceId, "RPT-20260616-LANG0001");
  assert.deepEqual(languages, ["en"]);
});

test("the receipt language survives the multipart path as a plain string field", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const languages = captureReceiptLanguage();
  const res = createResponse();

  // multer's memoryStorage puts every non-file field on req.body as a string,
  // so a FormData submission reaches the schema exactly like the JSON one.
  await contactController.submitContactForm(
    createContactRequest({ body: { language: " de " } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(languages, ["de"], "Joi should trim the field before it is resolved");
});

// The topic code. Until 2026-09-12 the `<option>` label and its value were the
// same English string and this controller compared against that string to
// decide whether a submission becomes a DSA report — so translating the
// dropdown would have switched report persistence off silently. These tests
// exist to make that failure loud if anyone re-couples the two.

const captureReportPersistence = () => {
  const captured = { reports: [], subjects: [] };
  contactReportModel.createReport = async (report) => {
    captured.reports.push(report);
    return { id: 16, reference_code: "RPT-20260616-TOPIC001" };
  };
  contactReportModel.updateEmailStatus = async () => ({});
  emailService.sendContactFormEmail = async (name, email, topic) => {
    captured.subjects.push(topic);
    return { success: true, messageId: "mail-topic" };
  };
  emailService.sendReportReceiptEmail = async () => ({
    success: true,
    messageId: "receipt-topic",
  });
  return captured;
};

test("submitContactForm recognises a report by its code, not by its label", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const captured = captureReportPersistence();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { topic: "report" } }),
    res,
  );

  // Fails against the pre-2026-09-12 controller, which only knew the English
  // sentence: no report, no reference id, and a 200 that looks like success.
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.referenceId, "RPT-20260616-TOPIC001");
  assert.equal(captured.reports.length, 1);
});

test("the stored topic and the inbox subject stay English when a code is sent", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const captured = captureReportPersistence();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { topic: "report" } }),
    res,
  );

  // contact_reports.topic holds English prose for every existing row, and the
  // inbox mail goes to the Lomir team rather than to a user. Resolving the
  // label on the way in keeps both true without a migration.
  assert.equal(captured.reports[0].topic, "Report content or abuse");
  assert.equal(
    captured.subjects[0],
    "Report content or abuse (RPT-20260616-TOPIC001)",
  );
});

test("the old English topic value still files a report during the deploy window", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const captured = captureReportPersistence();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { topic: "Report content or abuse" } }),
    res,
  );

  // ⚠️ Deploy order is migrate -> backend -> frontend, so this backend answers
  // the previous frontend bundle for a while. Dropping the legacy value before
  // the frontend ships would lose every report filed in that window.
  assert.equal(res.statusCode, 200);
  assert.equal(captured.reports.length, 1);
});

test("a translated report label is not mistaken for a report", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const captured = captureReportPersistence();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({
      body: { topic: "Inhalte oder Missbrauch melden" },
      files: [],
    }),
    res,
  );

  // Not a regression: it is the reason codes exist. A label is a label in any
  // language, and only the code decides. The German dropdown will send
  // "report" and be recognised; its visible text never reaches this comparison.
  assert.equal(res.statusCode, 200);
  assert.equal(captured.reports.length, 0);
  assert.equal(res.body.data, undefined);
});

test("an ordinary topic code keeps its English label and files nothing", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const captured = captureReportPersistence();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { topic: "feedback" }, files: [] }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(captured.reports.length, 0);
  assert.equal(captured.subjects[0], "Feedback");
});

test("an unknown topic is passed through rather than rejected or replaced", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;

  const captured = captureReportPersistence();
  const res = createResponse();

  await contactController.submitContactForm(
    createContactRequest({ body: { topic: "something else" }, files: [] }),
    res,
  );

  // Same reasoning as the loose `language` rule: the contact form must not
  // start losing messages because a value was not on a list.
  assert.equal(res.statusCode, 200);
  assert.equal(captured.subjects[0], "something else");
});
