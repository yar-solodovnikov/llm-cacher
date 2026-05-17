import { describe, it, expect, vi } from 'vitest'
import { LocalEmbedder } from '../src/embeddings/LocalEmbedder'

// Access private internals via type assertion — necessary to test pipeline caching
// without triggering a real model download
type Internals = { pipelinePromise: Promise<unknown> | null }

function getInternals(e: LocalEmbedder): Internals {
  return e as unknown as Internals
}

function injectPipeline(embedder: LocalEmbedder, p: Promise<unknown>): void {
  getInternals(embedder).pipelinePromise = p
}

describe('LocalEmbedder', () => {
  describe('dimensions', () => {
    it('defaults to 384', () => {
      expect(new LocalEmbedder().dimensions).toBe(384)
    })

    it('respects custom dimensions option', () => {
      expect(new LocalEmbedder({ dimensions: 768 }).dimensions).toBe(768)
    })
  })

  describe('embed', () => {
    it('converts pipeline output to a number array', async () => {
      // Use exact integer values to avoid Float32 ↔ Float64 precision noise
      const extractor = vi.fn().mockResolvedValue({ data: new Float32Array([1, 2, 3]) })
      const embedder = new LocalEmbedder()
      injectPipeline(embedder, Promise.resolve(extractor))

      const result = await embedder.embed('hello')
      expect(result).toEqual([1, 2, 3])
      expect(extractor).toHaveBeenCalledWith('hello', { pooling: 'mean', normalize: true })
    })

    it('reuses the resolved pipeline across multiple calls', async () => {
      const extractor = vi.fn().mockResolvedValue({ data: new Float32Array([1, 0, 0]) })
      const embedder = new LocalEmbedder()
      injectPipeline(embedder, Promise.resolve(extractor))

      await embedder.embed('a')
      await embedder.embed('b')

      // pipelinePromise is still set (not cleared) — means it was reused
      expect(getInternals(embedder).pipelinePromise).not.toBeNull()
      expect(extractor).toHaveBeenCalledTimes(2)
    })

    it('clears pipelinePromise after failure so the next call can retry', async () => {
      const embedder = new LocalEmbedder()
      const error = new Error('download failed')

      // Inject a rejected promise to simulate a failed model load without
      // actually downloading anything
      const rejected = Promise.reject(error)
      rejected.catch(() => {}) // suppress unhandled-rejection noise
      injectPipeline(embedder, rejected)

      await expect(embedder.embed('hello')).rejects.toThrow('download failed')

      // After failure, pipelinePromise must be null so the next embed() call
      // will attempt to load the pipeline again instead of returning the
      // cached rejected promise forever.
      expect(getInternals(embedder).pipelinePromise).toBeNull()
    })
  })
})
