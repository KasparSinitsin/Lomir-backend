/**
 * The topics the contact form offers, as stable codes.
 *
 * ⚠️ **This file exists because of a defect, and the defect is worth knowing
 * before anyone simplifies it away.** Until 2026-09-12 the `<option>` label and
 * its value were the same English string, and `submitContactForm` decided
 * whether a submission becomes a DSA report by comparing that string:
 *
 *     topic.trim() === "Report content or abuse"
 *
 * So translating the dropdown - the obvious next step for a page that is still
 * entirely English - would have meant no row in `contact_reports`, no reference
 * code and no receipt email. The report would have degraded silently into an
 * ordinary contact message, in the one channel the DSA obliges us to keep open,
 * and no test would have noticed because both repos read the same constant.
 *
 * The rule this follows is the project's existing one, applied here: English is
 * never control flow. A code crosses the wire, a label is what a human reads,
 * and the two must be free to diverge.
 *
 * The frontend keeps its own copy of the list in `src/pages/Contact.jsx`; the
 * two repos deploy separately, so a new topic changes both.
 */

const REPORT_TOPIC_CODE = "report";

/**
 * The English label for each code.
 *
 * This is what gets STORED in `contact_reports.topic` and what goes into the
 * subject of the inbox mail - deliberately, and deliberately English. Existing
 * rows hold English prose, and `sendContactFormEmail` goes to the Lomir team
 * rather than to a user, so it stays English (see `emailCopy.js`). Storing the
 * label rather than the code keeps both true without a migration.
 */
const CONTACT_TOPIC_LABELS = {
  general: "General question",
  account: "Account support",
  privacy: "Privacy request",
  [REPORT_TOPIC_CODE]: "Report content or abuse",
  feedback: "Feedback",
};

/**
 * What the pre-2026-09-12 frontend sends as the topic value.
 *
 * ⚠️ **Load-bearing during exactly one release, and removing it early breaks
 * the report channel.** The deploy order is migrate -> backend -> frontend, so
 * between the two deploys this backend is answering a frontend bundle that
 * still sends the English label. If `isReportTopic` only knew the code, every
 * abuse report filed in that window would be silently downgraded. It can go one
 * release after the frontend ships - not before.
 */
const LEGACY_REPORT_TOPIC = CONTACT_TOPIC_LABELS[REPORT_TOPIC_CODE];

/**
 * Whether this submission is an abuse / illegal-content report.
 *
 * Accepts the code and, for the transition window above, the old English
 * label. Nothing else - and in particular never a *translated* label, which is
 * the whole point: the German dropdown may say whatever reads best without this
 * function caring.
 */
const isReportTopic = (topic) => {
  if (typeof topic !== "string") return false;

  const trimmed = topic.trim();
  return trimmed === REPORT_TOPIC_CODE || trimmed === LEGACY_REPORT_TOPIC;
};

/**
 * The English label to store and to put in the inbox mail subject.
 *
 * An unknown value passes through unchanged rather than being replaced or
 * rejected: the Joi rule for `topic` is deliberately loose, and a submission
 * must never be lost because its topic was not on the list.
 */
const resolveTopicLabel = (topic) => {
  if (typeof topic !== "string") return "";

  const trimmed = topic.trim();
  if (!trimmed) return "";

  return CONTACT_TOPIC_LABELS[trimmed] || trimmed;
};

module.exports = {
  REPORT_TOPIC_CODE,
  CONTACT_TOPIC_LABELS,
  LEGACY_REPORT_TOPIC,
  isReportTopic,
  resolveTopicLabel,
};
