# Email Delivery & Verification — Current Setup

How Lomir sends transactional email (account verification, email-change
confirmation, password reset, password-changed notification, contact form)
and how the email verification flow works.

> **Status:** Email verification is **active**. New accounts must confirm their
> email before they can log in. There is no bypass flag in effect.

---

## Transport: Nodemailer over Gmail/Google SMTP

All outgoing email is sent through **Nodemailer** using **Gmail/Google SMTP**.
There is no third-party email-API provider in the dependency tree.

The transport is configured in `src/services/emailService.js` and is enabled
only when the SMTP environment variables are present:

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | SMTP server host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port (defaults to `587`, STARTTLS) |
| `SMTP_USER` | SMTP username / sending mailbox; also used as the `From` address |
| `SMTP_PASS` | SMTP password / app password |
| `FRONTEND_URL` | Base URL used to build links inside emails |

If `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are not all set, `sendEmail`
throws and no mail is sent — callers log the failure and degrade gracefully
(e.g. registration still creates the account; the user can request a new
verification email).

The `From` address is derived from the sending mailbox:

```js
const SMTP_FROM = `Lomir <${process.env.SMTP_USER}>`;
```

---

## Verification flow

1. **Registration** (`authController.register`) — the account is created with
   `email_verified = FALSE`, a 32-byte verification token (24-hour expiry) is
   stored, and a verification email is sent. The response is intentionally
   generic and contains no session token.
2. **Verification** (`GET /api/auth/verify-email?token=...`) — a valid,
   unexpired token sets `email_verified = TRUE` and clears the token.
3. **Login** (`authController.login`) — unverified accounts are rejected with a
   `requiresVerification` flag so the frontend can show the resend screen.
4. **Resend** (`POST /api/auth/resend-verification`) — issues a fresh token and
   email. The response is generic to avoid account enumeration.

The same Nodemailer transport also backs:

- **Email change** (`PUT /api/auth/change-email` → `GET /verify-email-change`)
- **Password reset** (`POST /api/auth/forgot-password` → `reset-password`)
- **Password-changed notification** (sent after `PUT /api/auth/change-password`)
- **Contact form / abuse reports** (`contactController`)

Email links are built from `FRONTEND_URL`, e.g.:

```
${process.env.FRONTEND_URL}/verify-email?token=${token}
```

Make sure `FRONTEND_URL` points to the correct frontend in both your local
`.env` and the Render environment (production), or links in emails will be wrong.

---

## Testing the full flow

1. Register a new account with a real email address.
2. Confirm the verification email arrives from the configured mailbox.
3. Click the link — you should land on `/verify-email` and see the success screen.
4. Log in with the new credentials.

Edge cases worth checking:

- Logging in before verifying (blocked with "Please verify your email").
- Resending the verification email.
- Expired verification tokens (24-hour window).
- Email change confirmation and password reset emails.

---

## History

Earlier versions of Lomir used the third-party [Resend](https://resend.com)
email API, with a `SKIP_EMAIL_VERIFICATION` feature flag that bypassed
verification while no custom domain was available. Both the Resend transport
and that bypass have been retired: delivery now runs entirely through
Nodemailer/Gmail SMTP and verification is always enforced. The `resend`
dependency has been removed from `package.json`.

> If a third-party email provider is ever reintroduced, update the
> [Privacy Policy](https://github.com/KasparSinitsin/Lomir-frontend) processor
> list (the "Service Providers and Recipients" / hosting-and-email section in
> `LegalPlaceholderPage.jsx`) so the new processor is disclosed before it
> handles any real user email.

---

## Related Documentation

- [Deployment Guide](../../LOMIR_DEPLOYMENT_GUIDE.md) — environment variables and deploy workflow
- [Local Setup Guide](../../LOMIR_LOCAL_SETUP_GUIDE.md) — local `.env` configuration
