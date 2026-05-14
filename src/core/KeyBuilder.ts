import { hashObject } from '../utils/hash'

export class KeyBuilder {
  // Exclude `stream` flag — streaming and non-streaming of the same request share one cache entry
  static build(params: Record<string, unknown>): string {
    const { stream: _stream, ...rest } = params
    return hashObject(rest)
  }
}
