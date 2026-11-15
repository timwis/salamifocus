---
status: accepted
date: 2026-11-15
status_note: "The user accepted either floating or zone-specific times in ticket 11, provided it stayed simple."
---

# Defer and due dates are instants

Defer and due dates are stored as instants (`timestamptz`), resolved in the device's time zone when the user types them, rather than as floating local date-times. Availability compares a defer date with the clock, and an instant lets the server, the web client and Android all answer that the same way with no record of the user's time zone. Floating times would have needed that zone on the server, plus a rule for which zone to use when devices disagree.

## Consequences

- A date typed as "1 Dec" means midnight (Defer) or 17:00 (Due) in the zone the device was in at the time. If the user later changes time zone, the time shown moves with it.
- OmniFocus stores floating times. Import (ticket 24) has to resolve them in the user's zone, and export (tickets 35 and 36) may have to turn them back into local times.
- Changing this later means migrating every stored date and deciding what zone each was meant in.
