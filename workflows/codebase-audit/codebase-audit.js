// harness bundled workflow — codebase-audit
// Maintainer-authored example against the documented workflow runtime API
// (export const meta + agent/parallel/pipeline/phase/log). Treat as a
// starting point: validate / regenerate in your project via `ultracode`
// then `/workflows` → s. Staged INERT by `harness init` (the gating flag
// featureFlags.standard_l4_dynamic_workflows stays off until you opt in).

export const meta = {
  name: 'codebase-audit',
  description: 'Fan-out correctness + security + performance sweep across the repo, then adversarially verify each finding before reporting.',
  phases: [
    { title: 'Scope', detail: 'pick the highest-value areas to audit' },
    { title: 'Review', detail: 'one reviewer per dimension' },
    { title: 'Verify', detail: 'adversarially confirm each finding' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'file', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: { real: { type: 'boolean' }, why: { type: 'string' } },
  required: ['real'],
}

phase('Scope')
const scope = await agent(
  'List the highest-value files/areas of THIS repository to audit — entry points, money/auth/data paths, and recently changed code. Return a short bullet list.',
  { label: 'scope' },
)

const DIMENSIONS = [
  { key: 'correctness', prompt: 'Off-by-one, nil/undefined handling, races, wrong invariants, contract violations.' },
  { key: 'security', prompt: 'Injection, authz gaps, secret leaks, unsafe deserialization, SSRF, path traversal.' },
  { key: 'performance', prompt: 'N+1 queries, unbounded loops/allocations, sync I/O on hot paths, missing pagination.' },
]

// Pipeline (no barrier): each dimension's findings verify as soon as that
// dimension's review completes, instead of waiting for all reviews.
const results = await pipeline(
  DIMENSIONS,
  d => agent(
    `Audit this repository for ${d.key} issues. ${d.prompt}\n\nAudit scope:\n${scope}`,
    { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS },
  ),
  (review, d) => parallel((review.findings || []).map(f => () =>
    agent(
      `Adversarially verify this ${d.key} finding — try to REFUTE it. Default real=false if uncertain.\n\n${JSON.stringify(f)}`,
      { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT },
    ).then(v => ({ ...f, dimension: d.key, verified: !!(v && v.real) })),
  )),
)

const confirmed = results.flat().filter(Boolean).filter(f => f.verified)
log(`codebase-audit: ${confirmed.length} confirmed finding(s)`)
return { confirmed }
