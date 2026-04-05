# Branch Protection Checklist

Apply this checklist to the live default branch before product implementation.

- [ ] Protect the default branch (`main` unless governance status artifacts record a different canonical branch model).
- [ ] Require pull requests before merge.
- [ ] Require at least one approving review.
- [ ] Dismiss stale approvals when new commits are pushed.
- [ ] Require conversation resolution before merge.
- [ ] Restrict force pushes and deletions.
- [ ] Require status checks when CI exists.
- [ ] Restrict direct pushes if the team workflow requires it.
- [ ] Reconcile the live branch-protection settings into the next bootstrap/adoption status artifact.
