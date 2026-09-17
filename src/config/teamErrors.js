/**
 * The failure codes the team endpoints (invitations, applications, vacant
 * roles) can answer with.
 *
 * Same shape and rules as `config/contactErrors.js` — read its header first:
 * `code` is stable and never shown, `values` carries only what the backend
 * alone knows, `message` stays so an old frontend keeps working and no deploy
 * order arises, and every payload key is camelCase.
 *
 * ⚠️ **Only the failures a normal user can reach carry a code** (plan decision
 * E2): races between two windows or two admins, where the UI was right when it
 * rendered and the data moved underneath it. Guards the UI already prevents —
 * authorisation, id and action validation, message length — stay prose, and
 * the frontend shows its own translated fallback for them, never `message`.
 * Do not add a code for a guard nobody can reach; it is a key nobody reads.
 *
 * Perspective is part of the code: `ALREADY_MEMBER` is the person acting,
 * `INVITEE_ALREADY_MEMBER` the person being invited.
 */

const TEAM_ERROR_CODES = {
  TEAM_NOT_FOUND: "TEAM_NOT_FOUND",
  TEAM_FULL: "TEAM_FULL",
  // values: { memberCount } — a new maximum below the current member count
  MAX_MEMBERS_BELOW_MEMBER_COUNT: "MAX_MEMBERS_BELOW_MEMBER_COUNT",

  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  ROLE_NOT_OPEN: "ROLE_NOT_OPEN",
  ROLE_OFFER_UNAVAILABLE: "ROLE_OFFER_UNAVAILABLE",
  // values: { roleName } — the role the user already fills
  ALREADY_FILLING_ROLE: "ALREADY_FILLING_ROLE",

  ALREADY_MEMBER: "ALREADY_MEMBER",
  INVITEE_ALREADY_MEMBER: "INVITEE_ALREADY_MEMBER",

  INVITATION_ALREADY_PENDING: "INVITATION_ALREADY_PENDING",
  INVITATION_UNAVAILABLE: "INVITATION_UNAVAILABLE",
  // The role part of a still-pending team invitation was already withdrawn.
  ROLE_INVITATION_WITHDRAWN: "ROLE_INVITATION_WITHDRAWN",
  INVITEE_HAS_PENDING_APPLICATION: "INVITEE_HAS_PENDING_APPLICATION",

  APPLICATION_ALREADY_PENDING: "APPLICATION_ALREADY_PENDING",
  APPLICATION_UNAVAILABLE: "APPLICATION_UNAVAILABLE",
};

module.exports = { TEAM_ERROR_CODES };
