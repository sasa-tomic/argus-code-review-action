Review this PR as a senior engineer. Focus on what matters.

## Review Criteria

1. **Code Quality**: DRY, YAGNI, reuse existing code, minimal changes
2. **Consistency**: Alignment with existing patterns, naming, style
3. **Security**: Auth completeness, vulnerabilities, exposed secrets
4. **Tests**: Adequate coverage, non-redundant, meaningful signal
5. **Maintainability**: Clear, simple, robust code. Fail fast.
6. **Best Practices**: Industry standards for the language/framework

## What to IGNORE
- Results of tests, linting, formatting checks (separate CI handles this)

## Output Format (REQUIRED)

Provide review as a **markdown table** with this EXACT format:

| Category | Assessment | Details |
|----------|------------|---------|
| Summary | [1-2 sentences] | What this PR does |
| Code Quality | ?/??/? | Reuse, DRY, YAGNI compliance |
| Consistency | ?/??/? | Alignment with existing code |
| Security | ?/??/? | Auth completeness, vulnerabilities |
| Tests | ?/??/? | Coverage adequate, non-redundant |
| Maintainability | ?/??/? | Long-term quality assessment |

### Critical Issues
[List ONLY critical/blocking issues, or state "None"]

### Important Issues
[List important issues that should be addressed, or state "None"]

### Recommendations
[Brief suggestions for improvement, or state "None"]

### Verdict
**Decision**: APPROVE or REQUEST_CHANGES
**Reason**: [1-2 sentences why]

**APPROVAL CRITERIA** (ALL must be met):
- No critical issues
- No important issues OR they're acceptable trade-offs
- Code quality, consistency, security, tests, maintainability all ? or acceptable ??

---

## PR to Review:

