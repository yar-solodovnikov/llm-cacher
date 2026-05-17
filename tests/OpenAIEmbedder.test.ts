import { describe, it, expect, vi } from 'vitest'
import { OpenAIEmbedder } from '../src/embeddings/OpenAIEmbedder'

function makeClient(embedding: number[]) {
  return {
    embeddings: {
      create: vi.fn().mockResolvedValue({ data: [{ embedding }] }),
    },
  }
}

describe('OpenAIEmbedder', () => {
  it('defaults to 1536 dimensions with the small model', () => {
    const embedder = new OpenAIEmbedder({ client: makeClient([]) })
    expect(embedder.dimensions).toBe(1536)
  })

  it('respects a custom dimensions option', () => {
    const embedder = new OpenAIEmbedder({ client: makeClient([]), dimensions: 512 })
    expect(embedder.dimensions).toBe(512)
  })

  it('returns the embedding array from the API response', async () => {
    const vec = [0.1, 0.2, 0.3]
    const client = makeClient(vec)
    const embedder = new OpenAIEmbedder({ client })
    expect(await embedder.embed('hello')).toEqual(vec)
  })

  it('forwards dimensions to the API when explicitly set', async () => {
    const client = makeClient([1, 2])
    const embedder = new OpenAIEmbedder({ client, model: 'text-embedding-3-large', dimensions: 512 })
    await embedder.embed('test')
    expect(client.embeddings.create).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 512 }),
    )
  })

  it('does NOT forward dimensions when not explicitly set (preserves compat with ada-002)', async () => {
    const client = makeClient([1, 2])
    const embedder = new OpenAIEmbedder({ client })
    await embedder.embed('test')
    const callArg = client.embeddings.create.mock.calls[0][0] as Record<string, unknown>
    expect(callArg).not.toHaveProperty('dimensions')
  })

  it('throws when the API returns no data', async () => {
    const badClient = {
      embeddings: {
        create: vi.fn().mockResolvedValue({ data: [] }),
      },
    }
    const embedder = new OpenAIEmbedder({ client: badClient })
    await expect(embedder.embed('empty')).rejects.toThrow('no data')
  })
})
