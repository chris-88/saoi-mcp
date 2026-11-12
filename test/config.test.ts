import { describe, expect, it } from 'vitest'
import { DEFAULT_PUBLIC_URL, loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('defaults the public URL to the production connector URL', () => {
    expect(loadConfig({}).publicUrl).toBe(DEFAULT_PUBLIC_URL)
    expect(DEFAULT_PUBLIC_URL).toBe('https://mcp.saoi.ie/mcp')
  })

  it('keeps PUBLIC_URL exactly as written and refuses one that is not a URL', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://mcp.chrisquinn.ie/mcp/' }).publicUrl).toBe(
      'https://mcp.chrisquinn.ie/mcp/',
    )
    expect(() => loadConfig({ PUBLIC_URL: 'mcp.saoi.ie' })).toThrow(/PUBLIC_URL/)
  })

  it('reads the OpenAI challenge token, unset when empty', () => {
    expect(loadConfig({}).openaiAppsChallenge).toBeUndefined()
    expect(loadConfig({ OPENAI_APPS_CHALLENGE: '  ' }).openaiAppsChallenge).toBeUndefined()
    expect(loadConfig({ OPENAI_APPS_CHALLENGE: 'abc' }).openaiAppsChallenge).toBe('abc')
  })
})
