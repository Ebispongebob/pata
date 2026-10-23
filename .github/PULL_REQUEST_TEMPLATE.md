<!--
### Contribution Checklist

- Use the title format "[Issue XYZ][component] Title", with the actual issue number.
  Omit "Issue XYZ" when there is no linked issue, and omit "component" when unsure.
  Example: [docs] Fix setup instructions.
- Keep the PR focused on one issue.
- Give each commit a meaningful message.
- Complete the sections below so reviewers can understand and verify the change.
- Remove unused placeholders and this checklist before submitting.

For typo-only fixes, omit sections that do not apply.
-->

Fixes #<xyz>

<!-- For a subtask of a larger issue, use "Master Issue: #<xyz>" instead. -->

### Motivation

Describe the problem, its context, and the expected outcome.

### Modifications

Describe what changed and any decisions reviewers need to understand.

### Verifying this change

- [ ] Relevant checks pass, including CI checks when available.

Describe the existing tests, integration checks, or manual steps used to verify the change.
Include the result and any checks that could not be completed.
For documentation-only changes or small cleanups, explain which checks apply.

### Does this pull request potentially affect one of the following parts?

For each item, answer yes or no and explain any impact.

- Dependencies:
- Public API:
- Data schema or stored files:
- Configuration defaults:
- Communication protocols:

### Documentation

- Does this PR introduce a new feature?
- Where is the feature documented: docs, GoDocs, or elsewhere?
- If documentation is not needed, explain why.
- If documentation will follow later, link the tracking issue.
