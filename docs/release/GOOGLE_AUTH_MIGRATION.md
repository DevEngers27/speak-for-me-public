# Deferred direct Google authentication exploration

The released product uses **Google sign-in through Clerk**, which is already working on the public website. The user chose to retain that route for the final demonstration and submission. No direct Google OAuth client configuration or new authentication deployment is a release requirement.

A separate direct Google Identity Services integration was explored and locally tested, but it is not part of the final released runtime. Its source is preserved offline for possible future work. The experiment's 2,177-test local result does not replace the released `97c1417` baseline's 2,154-test CI evidence. See [VALIDATION.md](VALIDATION.md) for the applicable release record.

Any future resumption would require an explicit configuration/deployment decision, exact Google issuer/audience verification, genuine sign-in acceptance, and an authorized identity-continuity plan. Existing rooms must not be reassigned by matching email addresses. No such migration was performed.
