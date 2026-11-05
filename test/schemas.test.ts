import { describe, expect, it } from 'vitest'
import { bazActAction, bazActInput, bazSayInput, bazStartInput, bazStatusInput } from '../src/tools.js'

const handle = 'h'.repeat(20)
const uuid = '123e4567-e89b-42d3-a456-426614174000'

describe('input schemas', () => {
  it('saoirse_start: source is optional and bounded', () => {
    expect(bazStartInput.safeParse({}).success).toBe(true)
    expect(bazStartInput.safeParse({ source: 'x'.repeat(41) }).success).toBe(false)
  })
  it('saoirse_say: needs handle and a non-empty bounded message', () => {
    expect(bazSayInput.safeParse({ handle, message: 'hi' }).success).toBe(true)
    expect(bazSayInput.safeParse({ handle, message: '  ' }).success).toBe(false)
    expect(bazSayInput.safeParse({ handle, message: 'x'.repeat(2001) }).success).toBe(false)
    expect(bazSayInput.safeParse({ handle: 'short', message: 'hi' }).success).toBe(false)
  })
  it('saoirse_status: needs a handle', () => {
    expect(bazStatusInput.safeParse({ handle }).success).toBe(true)
    expect(bazStatusInput.safeParse({}).success).toBe(false)
  })
  it('saoirse_act: flat input accepts known actions only', () => {
    expect(bazActInput.safeParse({ handle, action: 'pause_application', applicationId: uuid }).success).toBe(
      true,
    )
    expect(bazActInput.safeParse({ handle, action: 'wire_money' }).success).toBe(false)
  })
  it('saoirse_act: per-action validation and defaults', () => {
    const link = bazActAction.parse({ action: 'link_accounts', bank: 'demo' })
    expect(link).toMatchObject({ scope: ['balances', 'transactions', 'payments'] })
    expect(
      bazActAction.safeParse({
        action: 'initiate_transfer',
        fromAccountId: uuid,
        toApplicationId: null,
        amount: -1,
      }).success,
    ).toBe(false)
    expect(bazActAction.safeParse({ action: 'select_products', products: [] }).success).toBe(false)
  })
})
