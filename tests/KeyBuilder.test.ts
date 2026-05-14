import { describe, it, expect } from 'vitest'
import { KeyBuilder } from '../src/core/KeyBuilder'

describe('KeyBuilder', () => {
  it('produces the same hash for identical params', () => {
    const params = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }
    expect(KeyBuilder.build(params)).toBe(KeyBuilder.build(params))
  })

  it('produces the same hash regardless of object key order', () => {
    const a = KeyBuilder.build({ model: 'gpt-4o', temperature: 0.5, messages: [] })
    const b = KeyBuilder.build({ temperature: 0.5, messages: [], model: 'gpt-4o' })
    expect(a).toBe(b)
  })

  it('produces different hashes for different messages', () => {
    const a = KeyBuilder.build({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] })
    const b = KeyBuilder.build({ model: 'gpt-4o', messages: [{ role: 'user', content: 'world' }] })
    expect(a).not.toBe(b)
  })

  it('excludes the stream flag from the key', () => {
    const withStream = KeyBuilder.build({ model: 'gpt-4o', messages: [], stream: true })
    const withoutStream = KeyBuilder.build({ model: 'gpt-4o', messages: [] })
    expect(withStream).toBe(withoutStream)
  })

  it('returns a 64-char hex string (SHA-256)', () => {
    const key = KeyBuilder.build({ model: 'gpt-4o', messages: [] })
    expect(key).toMatch(/^[a-f0-9]{64}$/)
  })
})
