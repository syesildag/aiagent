---
description: Review a file or the current git diff for code quality issues
argument-hint: [file-path]
allowed-tools: "*"
---

Review the following for code quality, bugs, and best practices.

Use the code-standards skill to ensure the review covers all important areas.

$IF($1,
  **File to review:** @$1,
  **Current diff:**
  ```
  !`git diff HEAD`
  ```
)

Focus on:
- Logic errors and edge cases
- Security concerns (injection, unvalidated inputs, exposed secrets)
- Performance issues
- TypeScript type safety and strict-mode compliance
- Test coverage gaps

Provide specific line references and severity ratings (High / Medium / Low) for each issue found.
