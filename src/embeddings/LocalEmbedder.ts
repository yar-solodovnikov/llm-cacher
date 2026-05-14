import type { IEmbedder } from './IEmbedder'

// all-MiniLM-L6-v2 — 384 dims, ~25MB, no API key needed
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const DEFAULT_DIMENSIONS = 384
const PIPELINE_TASK = 'feature-extraction'
const POOLING_STRATEGY = 'mean'

export interface LocalEmbedderOptions {
  model?: string
}

export class LocalEmbedder implements IEmbedder {
  readonly dimensions = DEFAULT_DIMENSIONS
  private readonly model: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipelinePromise: Promise<any> | null = null

  constructor(opts: LocalEmbedderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getPipeline(): Promise<any> {
    if (this.pipelinePromise) return this.pipelinePromise
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pipeline } = require('@huggingface/transformers') as typeof import('@huggingface/transformers')
    this.pipelinePromise = pipeline(PIPELINE_TASK, this.model)
    return this.pipelinePromise
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await this.getPipeline()
    const output = await extractor(text, { pooling: POOLING_STRATEGY, normalize: true })
    return Array.from(output.data as Float32Array) as number[]
  }
}
