# Proposed teamService.js Boundaries

This pass intentionally does not move `teamController.js` business logic. The
controller mixes response formatting, permission checks, notification dispatch,
membership mutations, role state changes, and socket emissions. Moving that in
one step would make a zero-behavior-change review hard.

Recommended extraction order:

1. `teamMembershipService`
   - Own member lookup, role checks, add/remove member mutations, and successor
     selection helpers.
   - Keep controller-owned request authorization responses until tests cover all
     status-code branches.

2. `teamApplicationService`
   - Own application validation, duplicate checks, create/cancel/handle
     application mutations, and optional vacant-role linking.
   - Return structured outcomes so the controller can preserve existing
     response payloads and status codes.

3. `teamNotificationService`
   - Own notification record creation and socket event dispatch after successful
     mutations.
   - Keep event names and payload construction byte-for-byte compatible during
     extraction.

4. `teamProfileService`
   - Own read-side query composition for team details, member badges, team badge
     awards, and user team listings.
   - Extract only after adding response-shape snapshots for the affected
     endpoints.

Manual-review guardrails:

- Do not move route middleware or authorization ordering.
- Do not merge application, invitation, and vacant-role flows until their shared
  side effects are explicitly covered by tests.
- Keep controller error messages and status codes as the public API contract.
