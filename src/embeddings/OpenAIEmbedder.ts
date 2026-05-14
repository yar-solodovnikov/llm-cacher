import type { IEmbedder } from './IEmbedder'

const DEFAULT_MODEL = 'text-embedding-3-small'
// text-embedding-3-small outputs 1536 dims by default
const DEFAULT_DIMENSIONS = 1536

export interface OpenAIEmbedderOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  model?: string
  dimensions?: number
}

export class OpenAIEmbedder implements IEmbedder {
  readonly dimensions: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any
  private readonly model: string

  constructor(opts: OpenAIEmbedderOptions) {
    this.client = opts.client
    this.model = opts.model ?? DEFAULT_MODEL
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      ...(this.dimensions !== DEFAULT_DIMENSIONS && { dimensions: this.dimensions }),
    })
    const item = response.data[0]
    if (!item) throw new Error(`OpenAI embeddings API returned no data for model "${this.model}"`)
    return item.embedding as number[]
  }
}
