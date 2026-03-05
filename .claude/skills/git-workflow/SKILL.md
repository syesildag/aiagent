# Git Workflow Skill

Standard git workflow conventions for this project.

## Branch Naming

```
feature/<short-description>
fix/<issue-or-description>
chore/<task>
docs/<what>
```

## Commit Message Format

Follow the **Conventional Commits** specification:

```
<type>(<optional scope>): <short summary>

[optional body]

[optional footer: Closes #issue]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`.

## Pull Request Checklist

Before opening a PR ensure:
- [ ] `npm run build` passes (no TypeScript errors)
- [ ] `npm test` passes (all tests green)
- [ ] `npm run lint` clean
- [ ] Commit messages follow Conventional Commits format
- [ ] New code has corresponding unit tests
- [ ] Sensitive data (API keys, tokens) is not committed

## Release Flow

1. Merge feature branch → `main`
2. Tag: `git tag -a vX.Y.Z -m "release vX.Y.Z"`
3. Push tag: `git push origin vX.Y.Z`
