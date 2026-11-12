import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/v4'
import { OPERATIONS } from '../src/generated/operations.js'

const TOOLS = Object.keys(OPERATIONS).filter((name) => name.startsWith('saoi_'))

const GoldenPrompts = z.object({
  description: z.string().min(1),
  prompts: z.array(
    z.strictObject({
      id: z.string().regex(/^(direct|indirect|negative)-\d{2}$/),
      kind: z.enum(['direct', 'indirect', 'negative']),
      prompt: z.string().min(10),
      expectedTools: z.array(z.string()),
      note: z.string().min(1),
    }),
  ),
})

const golden = GoldenPrompts.parse(
  JSON.parse(readFileSync(new URL('./golden-prompts.json', import.meta.url), 'utf8')),
)

/** Shape only: the prompts are for evals against a host, not run here. */
describe('golden prompts', () => {
  it('has 12 direct, 15 indirect and 8 negative prompts with unique ids matching their kind', () => {
    const count = (kind: string) => golden.prompts.filter((p) => p.kind === kind).length
    expect([count('direct'), count('indirect'), count('negative')]).toEqual([12, 15, 8])
    expect(new Set(golden.prompts.map((p) => p.id)).size).toBe(golden.prompts.length)
    for (const p of golden.prompts) expect(p.id.startsWith(p.kind), p.id).toBe(true)
  })

  it('names Saoi only in direct prompts, expects tools that exist, and none for negatives', () => {
    for (const p of golden.prompts) {
      expect(/saoi/i.test(p.prompt), p.id).toBe(p.kind === 'direct')
      for (const tool of p.expectedTools) expect(TOOLS, p.id).toContain(tool)
      if (p.kind === 'negative') expect(p.expectedTools, p.id).toEqual([])
      else expect(p.expectedTools.length, p.id).toBeGreaterThan(0)
    }
  })
})
