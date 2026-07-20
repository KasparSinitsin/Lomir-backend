# Email Registration — Interim Solution & Restoration Guide

Documentation of the interim registration strategy and step-by-step instructions for restoring full email verification.

---

## Background

Lomir uses [Resend](https://resend.com) for transactional emails (account verification, password reset). Resend's free tier provides 100 emails/day and 3,000/month, which is sufficient for testing. However, without a verified custom domain, Resend only delivers emails from the sandbox sender (`onboarding@resend.dev`) to the **account holder's email address**. This means new users cannot receive verification emails during the current testing phase.

To unblock user registration while the app is deployed on free-tier infrastructure (Render + Vercel) without a custom domain, we introduced a **feature-flag bypass** that skips email verification entirely.

---

## How the Interim Solution Works

A single environment variable controls whether email verification is enforced:

```env
SKIP_EMAIL_VERIFICATION=true
```

When this flag is set to `true`:

1. **Registration** — the user is created, tags are saved, and the account is immediately set to `email_verified = TRUE`. A JWT token is returned in the response, logging the user in directly. No verification token is generated and no email is sent.
2. **Login** — the `email_verified` check is relaxed. Users who registered before the flag was set (and never verified) can still log in.
3. **Frontend** — no changes were needed. `AuthContext.jsx` already handled both paths: when the backend returns `requiresVerification: true` it shows the "check your email" screen, and when it returns a `token` + `user` directly it logs the user in.

All existing verification code remains in place and untouched — it is simply bypassed by an early `return` in the `register` method.

---

## Files Modified

| File | Change |
|------|--------|
| `src/controllers/authController.js` → `register` | Added conditional block (marked with `INTERIM` comments) that auto-verifies the user and returns a JWT when the flag is set |
| `src/controllers/authController.js` → `login` | Added `&& process.env.SKIP_EMAIL_VERIFICATION !== "true"` to the `email_verified` check |

No frontend files were modified.

---

## Where the Flag Is Set

| Environment | Location | Value |
|-------------|----------|-------|
| **Local development** | `Lomir-backend/.env` | `SKIP_EMAIL_VERIFICATION=true` |
| **Production (Render)** | Render dashboard → Backend service → Environment Variables | `SKIP_EMAIL_VERIFICATION=true` |

---

## Restoring Full Email Verification

Follow these steps when you are ready to enforce email verification for all new users.

### Prerequisites

Before you begin, make sure both of these are in place:

1. **A custom domain** (e.g. `lomir.app`) is configured and pointing at your deployment
2. **The domain is verified in Resend** — this requires adding DNS records (SPF, DKIM, and optionally DMARC) in your domain registrar. Resend's dashboard will show green checkmarks once the records propagate.

### Step 1 — Update the sender address

**File:** `src/services/emailService.js`

```js
// Before (sandbox — only delivers to account holder)
const FROM_EMAIL = "onboarding@resend.dev";

// After (verified domain — delivers to all recipients)
const FROM_EMAIL = "noreply@lomir.app";  // replace with your actual domain
```

### Step 2 — Verify the frontend URL

Make sure `FRONTEND_URL` points to your production frontend in **both** your local `.env` and Render environment variables. This URL is used to build the verification link in emails:

```env
FRONTEND_URL=https://lomir.app
```

The link template in `emailService.js` uses it like this:

```
${process.env.FRONTEND_URL}/verify-email?token=${token}
```

### Step 3 — Remove the feature flag

**On Render:** Dashboard → Backend service → Environment Variables → delete `SKIP_EMAIL_VERIFICATION` (or set it to `false`).

**In local `.env`:** Remove the line or set it to `false`:

```env
# SKIP_EMAIL_VERIFICATION=true
```

Render will redeploy automatically after the env var change. Restart your local backend (`npm run dev`) to pick up the change.

### Step 4 — Test the full flow

1. Register a new account with a real email address
2. Confirm you receive the verification email from your custom domain sender
3. Click the verification link — you should land on `/verify-email` and see the success screen
4. Log in with the new credentials

Also test the edge cases:

- Trying to log in before verifying (should be blocked with "Please verify your email")
- Resending the verification email
- Expired verification tokens (24-hour window)
- Password reset emails (these also use Resend)

---

## What Happens to Existing Users

Users who registered **during the interim period** are already marked `email_verified = TRUE` in the database. They are unaffected and can continue logging in normally after the flag is removed.

Users who register **after the flag is removed** will go through the full verification flow.

---

## Optional: Remove the Interim Code

Once full verification is confirmed working, you can optionally clean up the interim code. This is not required — the code is harmless when the flag is absent — but keeps the codebase tidy.

### In `src/controllers/authController.js` — `register` method

Delete the block between the `INTERIM` comments:

```js
      // ── INTERIM: skip email verification when flag is set ──
      if (process.env.SKIP_EMAIL_VERIFICATION === "true") {
        await db.query(
          `UPDATE users SET email_verified = TRUE WHERE id = $1`,
          [user.id],
        );

        const token = generateToken(user);

        return res.status(201).json({
          success: true,
          message: "Registration successful!",
          data: {
            token,
            user: {
              id: user.id,
              username: user.username,
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              bio: user.bio,
              postal_code: user.postal_code,
              city: user.city,
              country: user.country,
              avatar_url: user.avatar_url,
              is_public: user.is_public,
              created_at: user.created_at,
            },
          },
        });
      }
      // ── END INTERIM ──
```

### In `src/controllers/authController.js` — `login` method

Revert:

```js
      // Current (interim)
      if (!user.email_verified && process.env.SKIP_EMAIL_VERIFICATION !== "true") {
```

Back to:

```js
      // Original
      if (!user.email_verified) {
```

### Environment variables

Delete `SKIP_EMAIL_VERIFICATION` from Render and local `.env` if you haven't already.

---

## Related Documentation

- [Deployment Guide](../../LOMIR_DEPLOYMENT_GUIDE.md) — environment variables and deploy workflow
- [Local Setup Guide](../../LOMIR_LOCAL_SETUP_GUIDE.md) — local `.env` configuration
- Resend documentation: [https://resend.com/docs](https://resend.com/docs)
