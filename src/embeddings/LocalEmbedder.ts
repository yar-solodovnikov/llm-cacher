import type { IEmbedder } from './IEmbedder'
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../constants'

// all-MiniLM-L6-v2 — 384 dims, ~25MB, no API key needed
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const PIPELINE_TASK = 'feature-extraction'
const POOLING_STRATEGY = 'mean'

export interface LocalEmbedderOptions {
  model?: string
  dimensions?: number
}

export class LocalEmbedder implements IEmbedder {
  readonly dimensions: number
  private readonly model: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipelinePromise: Promise<any> | null = null

  constructor(opts: LocalEmbedderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL
    this.dimensions = opts.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getPipeline(): Promise<any> {
    if (this.pipelinePromise) return this.pipelinePromise
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pipeline } = require('@huggingface/transformers') as typeof import('@huggingface/transformers')
    this.pipelinePromise = pipeline(PIPELINE_TASK, this.model).catch((err: unknown) => {
      this.pipelinePromise = null
      throw err
    })
    return this.pipelinePromise
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await this.getPipeline().catch((err: unknown) => {
      this.pipelinePromise = null
      throw err
    })
    const output = await extractor(text, { pooling: POOLING_STRATEGY, normalize: true })
    return Array.from(output.data as Float32Array) as number[]
  }
}
