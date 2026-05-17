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
  private readonly explicitDimensions: boolean

  constructor(opts: OpenAIEmbedderOptions) {
    this.client = opts.client
    this.model = opts.model ?? DEFAULT_MODEL
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS
    // Track whether the caller explicitly chose a dimension count.
    // We only forward `dimensions` to the API when it was explicitly set so that
    // older models (e.g. text-embedding-ada-002) that don't accept the parameter
    // keep working, while non-default models (e.g. text-embedding-3-large whose
    // native output is 3072 dims) get the correct truncation requested.
    this.explicitDimensions = opts.dimensions !== undefined
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      ...(this.explicitDimensions && { dimensions: this.dimensions }),
    })
    const item = response.data[0]
    if (!item) throw new Error(`OpenAI embeddings API returned no data for model "${this.model}"`)
    return item.embedding as number[]
  }
}
