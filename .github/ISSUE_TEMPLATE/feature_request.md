---
name: Feature request
about: Suggest a capability Rill does not have yet
title: ''
labels: enhancement
assignees: ''
---

**What problem does this solve**

Describe the situation where the current behaviour is not enough. Concrete beats
abstract: a real stream, a real settlement flow, a real failure mode.

**What you would like it to do**

**Does this touch the money path?**

Anything that changes how or when FXRP moves needs more care than a read-only
change. Please read `SECURITY.md` first, particularly the notes on the asset
allowlist, the one-permit-per-session rule, and the two-phase quote/settle check.

- [ ] This is a read-only or reporting change
- [ ] This changes when or how a tick settles
- [ ] This changes the facilitator's verify/settle logic
- [ ] This adds a new write path

**Alternatives you considered**

**Anything else**
