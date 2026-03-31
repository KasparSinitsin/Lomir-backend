# Restoring Full Email Verification

## When to do this

You're ready to revert when **both** conditions are met:

1. You have a **custom domain** (e.g. `lomir.app`) pointed at your deployment
2. That domain is **verified in Resend** (DNS records: SPF, DKIM, and optionally DMARC are set up and confirmed green in Resend's dashboard)

---

## Step 1: Update Resend sender address

**File:** `src/services/emailService.js`

Change the `FROM_EMAIL` constant from the sandbox address to your verified domain:

```js
// Before (sandbox — only delivers to account holder)
const FROM_EMAIL = "onboarding@resend.dev";

// After (your verified domain — delivers to anyone)
const FROM_EMAIL = "noreply@lomir.app";  // adjust to your actual domain
```

---

## Step 2: Remove or disable the environment variable

In your **Render dashboard** → Backend service → Environment → Environment Variables:

- **Delete** the `SKIP_EMAIL_VERIFICATION` variable entirely
- Or set its value to `false`

The backend service will redeploy automatically.

---

## Step 3: Verify the frontend URL is correct

**File:** Backend `.env` (or Render env vars)

Make sure `FRONTEND_URL` points to your production frontend, since verification emails contain a link back to it:

```env
FRONTEND_URL=https://lomir.app
```

This is used in `emailService.js` to build the verification link:
```
${process.env.FRONTEND_URL}/verify-email?token=${token}
```

---

## That's it — no code to remove

The interim changes were designed so that **no code needs to be deleted or modified** (apart from the sender address above). Here's why:

| What happens when the flag is absent or `false` | |
|---|---|
| `register` method | The `SKIP_EMAIL_VERIFICATION` block is skipped, falls through to the existing verification token + email flow |
| `login` method | The condition `process.env.SKIP_EMAIL_VERIFICATION !== "true"` evaluates to `true`, so the `email_verified` check is enforced as before |
| Frontend `AuthContext.jsx` | Receives `requiresVerification: true` from the backend again, shows the "check your email" screen |
| `VerifyEmail.jsx` | Works as before — user clicks the email link, token is validated, account is activated |

---

## Optional cleanup

If you want to remove the interim code entirely after confirming everything works, here's what to look for:

**`src/controllers/authController.js` — `register` method**

Delete the block between the `INTERIM` comments:

```js
      // ── INTERIM: skip email verification when flag is set ──
      if (process.env.SKIP_EMAIL_VERIFICATION === "true") {
        // ... entire block ...
      }
      // ── END INTERIM ──
```

**`src/controllers/authController.js` — `login` method**

Revert the condition back to:

```js
      // Check if email is verified
      if (!user.email_verified) {
```

(Remove the `&& process.env.SKIP_EMAIL_VERIFICATION !== "true"` part.)

**Render environment**

Delete the `SKIP_EMAIL_VERIFICATION` variable if you haven't already.

---

## Handling existing unverified users

After re-enabling verification, any users who registered during the interim period are already marked `email_verified = TRUE` in the database (the flag auto-verified them at registration). They won't be affected and can continue logging in normally.

New users registering after the switch will go through the full email verification flow.
