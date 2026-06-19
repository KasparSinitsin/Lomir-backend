# DSA Report Handling — Internal Runbook

**Status:** Active · **Last updated:** June 17, 2026

Internal operating procedure for how the Lomir operators receive, assess, decide
on, and document content/abuse reports. Lomir is a non-commercial, two-person
open-source project; report handling is intentionally run over **email**, not a
moderation UI. This document is **operational guidance, not legal advice** — for
a binding assessment consult a lawyer.

---

## 1. Scope and legal context

Reports reach us through the contact form when the user selects the topic
**"Report content or abuse"**. Two DSA articles drive how we respond:

- **Art. 16 DSA (notice and action):** we must let a reporter know we received
  their notice and, without undue delay, inform them of the decision taken.
- **Art. 17 DSA (statement of reasons):** *if* we take a measure against a user's
  content/account, that affected user must receive a clear, specific statement of
  reasons.

As a likely **micro/small enterprise (Art. 19 DSA)** we are exempted from
Chapter III, Section 3 — in particular the internal complaint-handling system
(Art. 20), out-of-court dispute settlement (Art. 21), and submission of every
statement of reasons to the EU Transparency Database (Art. 24(5)). Art. 16 and
Art. 17 sit in Section 2 and **still apply**, so the receipt confirmation and the
statement of reasons are the two obligations we actively maintain.

> This classification is our working assumption, not a determination. If Lomir
> ever becomes commercial or grows beyond the micro/small thresholds, revisit the
> Art. 19 exemption — Art. 20/21/24 would then apply.

## 2. What the system does automatically

No manual step is needed for intake; the backend already handles it:

- **Persistence:** a report is stored in the `contact_reports` table with a unique
  **reference code** of the form `RPT-YYYYMMDD-XXXXXXXX`
  (`src/models/contactReportModel.js`). If persistence fails, the request fails —
  the user never gets a fake success.
- **Operator notification:** the full report (with any attachment metadata) is
  emailed to the operator inbox (`SMTP_USER`) via `sendContactFormEmail`, with the
  reference code in the subject.
- **Receipt confirmation (Art. 16):** the reporter automatically receives an
  acknowledgement email containing their reference code, via
  `sendReportReceiptEmail` (`src/controllers/contactController.js`). This is
  best-effort: the report is already persisted and the reference ID is shown
  on screen, so a failed receipt email never fails the submission.

Everything after intake — assessment, decision, and communicating it — is
**manual, over email** (see §4).

## 3. Source of truth and record-keeping

Because we deliberately have no moderation UI yet, the **authoritative record of
how a report was handled is the Gmail thread**, anchored by the reference code.
Treat the records as follows so a later audit can reconstruct each case:

- **Reference code in every message.** Keep the `RPT-…` code in the subject of
  every email of a case (the intake and receipt mails already carry it). This is
  what ties intake → assessment → decision → notification together.
- **Dedicated, append-only archive.** Keep a Gmail label (e.g. `DSA-Reports`) and
  **never delete** anything filed under it: the original report, our internal
  assessment, the outcome notice to the reporter, and any statement of reasons to
  an affected user.
- **Periodic export.** Export the label to PDF/`.eml` on a fixed cadence
  (e.g. quarterly) and store it with the project records. Gmail timestamps are a
  reliable record of *when* a message was sent; an export protects against
  accidental deletion and account loss.
- **Database `status` is secondary.** `contact_reports.status` exists
  (`received → under_review → action_taken → closed`) but, without tooling, stays
  at its default `received`. It is **not** the source of truth today — the email
  thread is. Do not rely on it for audit evidence until status transitions are
  actually wired up (see §6).

## 4. Processing workflow

1. **Triage.** A new report arrives in the operator inbox. File it under the
   `DSA-Reports` label. Confirm the reporter already got the automatic receipt
   (it is sent automatically; only follow up manually if you have reason to think
   it failed).
2. **Assess.** Decide whether the reported content/behaviour violates the law or
   the Lomir Terms. Capture the relevant evidence (screenshots, the offending
   text, profile/team IDs) and keep it in the thread.
3. **Decide.** Choose the measure, if any: no action, content removal, account
   suspension/restriction, or other. Note the territorial scope and duration
   where relevant.
4. **Communicate.**
   - **To the affected user** (only if a measure is taken): send the **statement
     of reasons** — use the template in §5.
   - **To the reporter:** inform them of the outcome (Art. 16(5)) — use the short
     note in §5. Do not disclose another user's personal data; keep it to the
     fact that the report was reviewed and what category of action followed.
5. **Close.** Make sure the thread contains: the original report, the evidence,
   the decision, and the message(s) sent. That bundle is the case record.

## 5. Email templates

Send in **English** (Lomir's user-facing language). Replace every `[...]`
placeholder. Attach screenshots/evidence where helpful.

### 5a. Statement of reasons — to the affected user (Art. 17)

```
Subject: Lomir — action taken on your content/account [RPT-YYYYMMDD-XXXXXXXX]

Hello [name],

We are writing to inform you about a decision we have taken regarding your
content/account on Lomir.

Measure taken:
[e.g. removal of a specific message / team / profile element; account
suspension; restriction of a feature]

Scope and duration (where applicable):
[e.g. removal is permanent / suspension applies for X days / applies to the EU]

Facts and circumstances this decision is based on:
[Briefly describe what was found and, where useful, reference the attached
evidence/screenshots.]

Ground for the decision:
[Choose one and be specific:
 - Illegal content: identify the legal provision and explain why the content is
   considered unlawful; or
 - Terms violation: cite the specific clause of the Lomir Terms of Service and
   explain how it was breached.]

Automated means:
This decision was made by a human reviewer; no automated decision-making was
used.

How to seek redress:
If you believe this decision is incorrect, you may reply to this email to ask us
to reconsider, and you retain the right to pursue judicial redress before the
competent courts.

Reference: [RPT-YYYYMMDD-XXXXXXXX]

Kind regards,
The Lomir team
```

> **Art. 17 checklist** — a complete statement of reasons covers: (a) the measure
> and its scope/duration; (b) the facts relied on; (c) whether automated means
> were used; (d) the legal ground (illegal content) **or** (e) the contractual
> ground (Terms clause); (f) available redress. The template covers all six;
> don't drop a section — write "not applicable" instead.

### 5b. Outcome notice — to the reporter (Art. 16(5))

```
Subject: Lomir — outcome of your report [RPT-YYYYMMDD-XXXXXXXX]

Hello [name],

Thank you for your report (reference [RPT-YYYYMMDD-XXXXXXXX]). We have reviewed
it and [taken appropriate action under our Terms of Service / found no violation
of our Terms or applicable law].

We are unable to share details about another user's account, but we wanted to
confirm that your report was assessed by a human reviewer.

Thank you for helping keep Lomir safe.

Kind regards,
The Lomir team
```

## 6. Deferred — future tooling

Intentionally **not built yet**; the email workflow above is the current process.
When report volume justifies it, the natural next steps are:

- A small CLI script to transition `contact_reports.status` and store an internal
  handler note (the status enum and an index already exist in
  `src/database/migrations/create_contact_reports.js`).
- Later, a minimal moderation view.

Until then, the Gmail thread + reference code (§3) is the system of record.

---

## References

- Backend intake: `src/controllers/contactController.js`,
  `src/models/contactReportModel.js`,
  `src/database/migrations/create_contact_reports.js`
- Emails: `src/services/emailService.js`
  (`sendContactFormEmail`, `sendReportReceiptEmail`)
- DSA: Regulation (EU) 2022/2065, Articles 16, 17, 19.
