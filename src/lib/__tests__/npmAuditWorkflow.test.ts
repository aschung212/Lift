import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Pins the LIFT-1122 contract: a scheduled full-tree npm audit gate that runs
// independently of CI's PR-diff-only dependency-review, so a newly-disclosed
// CVE in an already-pinned transitive dep fails a check automatically.
const ROOT = resolve(__dirname, '../../..')
const AUDIT_PATH = resolve(ROOT, '.github/workflows/npm-audit.yml')

describe('npm audit workflow — structural', () => {
  const yaml = () => readFileSync(AUDIT_PATH, 'utf8')

  it('workflow file exists', () => {
    expect(existsSync(AUDIT_PATH)).toBe(true)
  })

  it('audits the full tree at high severity', () => {
    expect(yaml()).toContain('npm audit --audit-level=high')
  })

  it('runs on a schedule so it fires between weekly Dependabot runs', () => {
    const y = yaml()
    expect(y).toMatch(/schedule:/)
    expect(y).toMatch(/cron:/)
  })

  it('is manually dispatchable', () => {
    expect(yaml()).toContain('workflow_dispatch')
  })

  it('re-audits when the resolved lockfile changes', () => {
    const y = yaml()
    expect(y).toMatch(/pull_request:/)
    expect(y).toContain('package-lock.json')
  })

  it('grants only read access to repo contents', () => {
    expect(yaml()).toMatch(/permissions:\s*\n\s*contents:\s*read/)
  })
})
