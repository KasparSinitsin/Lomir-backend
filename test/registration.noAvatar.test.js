// No avatar at registration (STATUS item 59, decided 2026-10-12): a picture is
// uploaded from the profile after the e-mail confirmation. The form parser drops
// files, and the controller drops an avatar URL, so an older form still works.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const db = require("../src/config/database");
const userModel = require("../src/models/userModel");
const emailService = require("../src/services/emailService");
const authController = require("../src/controllers/authController");
const { parseRegistrationForm } = require("../src/middlewares/registrationForm");

const saved = {
  findByEmail: userModel.findByEmail,
  findByUsername: userModel.findByUsername,
  createUser: userModel.createUser,
  sendVerificationEmail: emailService.sendVerificationEmail,
  poolQuery: db.pool.query,
  turnstile: process.env.TURNSTILE_SECRET_KEY,
};

test.afterEach(() => {
  userModel.findByEmail = saved.findByEmail;
  userModel.findByUsername = saved.findByUsername;
  userModel.createUser = saved.createUser;
  emailService.sendVerificationEmail = saved.sendVerificationEmail;
  db.pool.query = saved.poolQuery;
  if (saved.turnstile === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = saved.turnstile;
  }
});

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

test("the form parser keeps the fields and drops an avatar file", async () => {
  const app = express();
  app.post("/register", parseRegistrationForm, (req, res) => {
    res.json({ body: req.body, files: (req.files || []).length, file: Boolean(req.file) });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const form = new FormData();
    form.append("username", "newperson");
    form.append("email", "new@example.com");
    form.append("avatar", new Blob([Buffer.from("not really a png")], { type: "image/png" }), "me.png");

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/register`, { method: "POST", body: form });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(result.body, { username: "newperson", email: "new@example.com" });
    assert.equal(result.files, 0);
    assert.equal(result.file, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("registration stores no avatar, even when an older form sends a URL", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  userModel.findByEmail = async () => null;
  userModel.findByUsername = async () => null;
  let created = null;
  userModel.createUser = async (value) => {
    created = value;
    return { id: 77, email: value.email, username: value.username, preferred_language: null, country: null };
  };
  emailService.sendVerificationEmail = async () => ({ success: true });
  db.pool.query = async () => ({ rows: [], rowCount: 1 });

  const res = createResponse();
  await authController.register(
    {
      body: {
        username: "newperson",
        email: "new@example.com",
        password: "secret123",
        avatar_url: "https://ik.imagekit.io/demo123/lomir/avatars/old_form.png",
        acceptedTerms: true,
        acceptedPrivacy: true,
        confirmedAge16: true,
      },
      file: { buffer: Buffer.from("x"), originalname: "me.png" },
    },
    res,
  );

  assert.ok(res.statusCode < 300, `status ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.ok(created, "the account was created");
  assert.equal("avatar_url" in created, false);
});
