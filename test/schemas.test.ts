import { describe, expect, it } from 'vitest'
import {
  saoirseActAction,
  saoirseActInput,
  saoirseSayInput,
  saoirseStartInput,
  saoirseStatusInput,
} from '../src/tools.js'

const handle = 'h'.repeat(20)
const uuid = '123e4567-e89b-42d3-a456-426614174000'

describe('input schemas', () => {
  it('saoirse_start: source is optional and bounded', () => {
    expect(saoirseStartInput.safeParse({}).success).toBe(true)
    expect(saoirseStartInput.safeParse({ source: 'x'.repeat(41) }).success).toBe(false)
  })
  it('saoirse_say: needs handle and a non-empty bounded message', () => {
    expect(saoirseSayInput.safeParse({ handle, message: 'hi' }).success).toBe(true)
    expect(saoirseSayInput.safeParse({ handle, message: '  ' }).success).toBe(false)
    expect(saoirseSayInput.safeParse({ handle, message: 'x'.repeat(2001) }).success).toBe(false)
    expect(saoirseSayInput.safeParse({ handle: 'short', message: 'hi' }).success).toBe(false)
  })
  it('saoirse_status: needs a handle', () => {
    expect(saoirseStatusInput.safeParse({ handle }).success).toBe(true)
    expect(saoirseStatusInput.safeParse({}).success).toBe(false)
  })
  it('saoirse_act: flat input accepts known actions only', () => {
    expect(
      saoirseActInput.safeParse({ handle, action: 'pause_application', applicationId: uuid }).success,
    ).toBe(true)
    expect(saoirseActInput.safeParse({ handle, action: 'wire_money' }).success).toBe(false)
  })
  it('saoirse_act: per-action validation and defaults', () => {
    const link = saoirseActAction.parse({ action: 'link_accounts', bank: 'demo' })
    expect(link).toMatchObject({ scope: ['balances', 'transactions', 'payments'] })
    expect(
      saoirseActAction.safeParse({
        action: 'initiate_transfer',
        fromAccountId: uuid,
        toApplicationId: null,
        amount: -1,
      }).success,
    ).toBe(false)
    expect(saoirseActAction.safeParse({ action: 'select_products', products: [] }).success).toBe(false)
  })
})
