/**
 * The text of every user-facing transactional email, per language.
 *
 * Email is the ONE thing the backend translates. Everywhere else it emits data
 * and the frontend formulates — see the i18n plan. The reason is simply that a
 * mail client has no language and no picker: whatever is sent is what the person
 * reads, forever.
 *
 * ⚠️ German is the informal "Du" throughout. Julia's call, 2026-09-12, and it
 * matches the app: 201 German UI strings use Du forms and none uses the formal
 * address. A mail that said "Sie" would be a break in tone, not a politeness.
 *
 * ⚠️ These strings are STATIC and may contain markup (`<strong>`). User input
 * never appears here — the builders in `emailService.js` escape it and
 * interpolate it into the `{placeholder}` slots. Never put a value from a
 * request into this file, and never make one of these strings dynamic.
 *
 * `sendContactFormEmail` is deliberately absent: it goes to the Lomir inbox,
 * not to a user, and stays English.
 */

const { DEFAULT_LANGUAGE, isSupportedLanguage } = require("../config/languages");

const COPY = {
  verification: {
    en: {
      subject: "Verify your Lomir account",
      heading: "Welcome to Lomir, {username}!",
      intro:
        "Thanks for signing up! Please verify your email address by clicking the button below:",
      button: "Verify Email Address",
      settingsLink: "account settings",
      privacy:
        "Once verified, your profile will remain <strong>private by default</strong>. Other Lomir users can only find your full profile if you actively make it public in your {settingsLink} after logging in.",
      expiry:
        "This link will expire in <strong>24 hours</strong>. If you don't verify your account within this time, your registration will be automatically deleted and you'll need to sign up again.",
      ignore:
        "If you didn't create a Lomir account, you can safely ignore this email — the unverified account will be removed automatically.",
      fallback:
        "If the button doesn't work, copy and paste this link into your browser:",
    },
    de: {
      subject: "Bestätige dein Lomir-Konto",
      heading: "Willkommen bei Lomir, {username}!",
      intro:
        "Danke für deine Anmeldung! Bitte bestätige deine E-Mail-Adresse über den Button:",
      button: "E-Mail-Adresse bestätigen",
      settingsLink: "Kontoeinstellungen",
      privacy:
        "Nach der Bestätigung bleibt dein Profil <strong>standardmäßig privat</strong>. Andere Lomir-Mitglieder finden dein vollständiges Profil nur, wenn du es nach dem Anmelden in den {settingsLink} aktiv öffentlich machst.",
      expiry:
        "Dieser Link ist <strong>24 Stunden</strong> gültig. Bestätigst du dein Konto nicht in dieser Zeit, wird die Registrierung automatisch gelöscht und du musst dich erneut anmelden.",
      ignore:
        "Hast du kein Lomir-Konto angelegt, kannst du diese E-Mail einfach ignorieren — das unbestätigte Konto wird automatisch entfernt.",
      fallback:
        "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:",
    },
  },

  passwordReset: {
    en: {
      subject: "Reset your Lomir password",
      heading: "Password Reset Request",
      intro:
        "Hi {username}, we received a request to reset your Lomir password. Click the button below to create a new password:",
      button: "Reset Password",
      expiry:
        "This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.",
      fallback:
        "If the button doesn't work, copy and paste this link into your browser:",
    },
    de: {
      subject: "Setze dein Lomir-Passwort zurück",
      heading: "Passwort zurücksetzen",
      intro:
        "Hallo {username}, wir haben eine Anfrage erhalten, dein Lomir-Passwort zurückzusetzen. Klicke auf den Button, um ein neues Passwort zu wählen:",
      button: "Passwort zurücksetzen",
      expiry:
        "Dieser Link ist <strong>eine Stunde</strong> gültig. Hast du kein Zurücksetzen angefordert, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.",
      fallback:
        "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:",
    },
  },

  emailChange: {
    en: {
      subject: "Confirm your new Lomir email address",
      heading: "Confirm your new email address",
      intro:
        "Hi {username}, we received a request to use this email address for your Lomir account. Please confirm the change by clicking the button below:",
      button: "Confirm Email Change",
      expiry:
        "This link will expire in <strong>24 hours</strong>. Your current email address will stay active until this new address is confirmed.",
      ignore:
        "If you did not request this change, you can ignore this email.",
      fallback:
        "If the button doesn't work, copy and paste this link into your browser:",
    },
    de: {
      subject: "Bestätige deine neue Lomir-E-Mail-Adresse",
      heading: "Neue E-Mail-Adresse bestätigen",
      intro:
        "Hallo {username}, wir haben eine Anfrage erhalten, diese E-Mail-Adresse für dein Lomir-Konto zu verwenden. Bitte bestätige die Änderung über den Button:",
      button: "Änderung bestätigen",
      expiry:
        "Dieser Link ist <strong>24 Stunden</strong> gültig. Deine bisherige E-Mail-Adresse bleibt aktiv, bis die neue bestätigt ist.",
      ignore:
        "Hast du diese Änderung nicht angefordert, kannst du diese E-Mail ignorieren.",
      fallback:
        "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:",
    },
  },

  passwordChanged: {
    en: {
      subject: "Your Lomir password was changed",
      heading: "Your password was changed",
      intro:
        "Hi {username}, this is a confirmation that the password for your Lomir account was just changed.",
      ifYou: "If you made this change, you can safely ignore this email.",
      loginButton: "Login to Lomir with new Password",
      warning:
        "<strong>If you did not change your password</strong>, your account may be compromised. Please reset your password immediately using the button below:",
      resetButton: "Reset Password",
      fallback:
        "If the button doesn't work, copy and paste this link into your browser:",
    },
    de: {
      subject: "Dein Lomir-Passwort wurde geändert",
      heading: "Dein Passwort wurde geändert",
      intro:
        "Hallo {username}, das Passwort für dein Lomir-Konto wurde gerade geändert. Dies ist die Bestätigung dazu.",
      ifYou: "Warst du das, kannst du diese E-Mail einfach ignorieren.",
      loginButton: "Mit neuem Passwort bei Lomir anmelden",
      warning:
        "<strong>Hast du dein Passwort nicht geändert</strong>, ist dein Konto möglicherweise gefährdet. Setze das Passwort bitte sofort über den Button zurück:",
      resetButton: "Passwort zurücksetzen",
      fallback:
        "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:",
    },
  },

  reportReceipt: {
    en: {
      subject: "We received your Lomir report ({reference})",
      heading: "We received your report",
      intro:
        "Hi {name}, thank you for reporting content or abuse on Lomir. This is an automated confirmation that we have received your report and will review it.",
      referenceLabel: "Reference ID:",
      nothingFurther:
        "You do not need to do anything further. Please keep this reference ID in case you want to refer to your report later. If you have more details to add, simply reply to this email.",
      footer:
        "This is an automated message confirming receipt. We review reports in line with our Terms of Service and will take action where appropriate.",
    },
    de: {
      subject: "Wir haben deine Lomir-Meldung erhalten ({reference})",
      heading: "Wir haben deine Meldung erhalten",
      intro:
        "Hallo {name}, danke für deine Meldung zu Inhalten oder Missbrauch auf Lomir. Dies ist eine automatische Bestätigung, dass deine Meldung eingegangen ist und geprüft wird.",
      referenceLabel: "Vorgangsnummer:",
      nothingFurther:
        "Du musst nichts weiter tun. Bewahre die Vorgangsnummer auf, falls du später auf deine Meldung Bezug nehmen möchtest. Hast du weitere Angaben, antworte einfach auf diese E-Mail.",
      footer:
        "Dies ist eine automatische Eingangsbestätigung. Wir prüfen Meldungen gemäß unseren Nutzungsbedingungen und handeln, wo es angebracht ist.",
    },
  },
};

/**
 * The copy for one template in one language.
 *
 * An unsupported or missing language falls back to DEFAULT_LANGUAGE rather than
 * throwing: a mail that goes out in the wrong language is a defect, a mail that
 * does not go out at all can lock someone out of their account.
 */
const emailCopy = (template, language) => {
  const table = COPY[template];
  if (!table) {
    throw new Error(`emailCopy: unknown template "${template}"`);
  }
  const lang = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
  return table[lang] || table[DEFAULT_LANGUAGE];
};

/** Fill `{slot}` placeholders. Values must already be escaped by the caller. */
const fill = (text, values = {}) =>
  String(text).replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );

module.exports = { emailCopy, fill, COPY };
