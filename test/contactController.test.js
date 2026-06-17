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
  emailService.sendReportReceiptEmail = async (name, email, referenceCode) => {
    receiptCalls.push({ name, email, referenceCode });
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
