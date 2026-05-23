# Small Beta Rollout Plan

> Goal: validate Hera with a small group of OpenCode users before broad promotion. Keep the promise narrow: Hera is an OpenCode plugin for persistent agents, skills, memory, and teams.

## Stage 0: Release Prerequisites

- [ ] npm login works: `npm whoami` returns the maintainer account.
- [ ] Publish succeeds: `npm publish`.
- [ ] Registry confirms version: `npm view hera-agent version` returns `2.2.0`.
- [ ] Clean environment smoke test passes on at least one Windows and one Linux/macOS environment.
- [ ] GitHub release notes link to `docs/CANONICAL_DEMO.md` and `docs/INSTALLATION.md`.

## Stage 1: Private Beta

Audience: 5-10 people who already use or are willing to install OpenCode.

Ask each tester to do exactly three tasks:

1. Install Hera with the npm prefix path and run `doctor`.
2. Create one persistent agent from a template and use it in a new OpenCode session.
3. Create one two-member team, send a message, and store one item in the team workspace / blackboard.

Feedback questions:

- Did installation work on the first try?
- Did `doctor` tell you what to do when something failed?
- Was the difference between agent, skill, team, message inbox, and shared workspace clear?
- What was the first moment where you felt confused?
- Would you use this again in an OpenCode workflow? Why or why not?

Success threshold:

- 80% of testers complete install + doctor without maintainer help.
- 60% complete agent + team creation without maintainer help.
- No data-loss or uninstall bugs.

## Stage 2: Public Beta

Audience: OpenCode community, GitHub watchers, developer friends, small technical communities.

Channels:

1. OpenCode community / Discord, if available.
2. GitHub README + release page.
3. X thread from `docs/launch/x-thread.md`.
4. Reddit post from `docs/launch/reddit.md` after at least one private beta pass.

CTA:

```bash
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Monitoring checklist:

- Watch GitHub issues for install failures.
- Track common confusion points in `docs/launch/beta-feedback.md` if feedback volume grows.
- Patch docs within 24 hours for repeated installation confusion.
- Patch code within 24 hours for install/data-loss blockers.

## Stage 3: Broader Launch

Do not run a broader launch until:

- npm install succeeds from registry on Windows + Linux/macOS.
- Canonical demo is reproduced by someone other than the maintainer.
- README no longer says or implies Hera is a standalone agent platform.
- At least three beta users report a successful end-to-end flow.

Broader launch candidates:

- Show HN.
- Awesome lists / OpenCode plugin directories.
- Long-form technical post on how Hera implements OpenCode-native agent persistence and team coordination.
