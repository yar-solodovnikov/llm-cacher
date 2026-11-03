import 'reflect-metadata'
import { Module, Injectable, Inject, type DynamicModule } from '@nestjs/common'
import { createCachedClientForProvider, type LlmProvider } from '../adapters/auto'
import { buildManager } from '../adapters/shared'
import type { CacheManager } from '../core/CacheManager'
import type { LlmCacheOptions } from '../adapters/base'

const LLM_CACHE_OPTIONS = Symbol('LLM_CACHE_OPTIONS')

@Injectable()
export class LlmCacheService {
  private readonly manager: CacheManager

  constructor(@Inject(LLM_CACHE_OPTIONS) options: LlmCacheOptions) {
    this.manager = buildManager(options)
  }

  /**
   * Wraps an OpenAI, Anthropic, Gemini or Mistral client with caching. The SDK is detected
   * from the client's shape; pass `provider` to set it explicitly.
   * All wrapped clients share the same CacheManager instance.
   *
   * @example
   * const openai = this.llmCache.wrap(new OpenAI())
   * const anthropic = this.llmCache.wrap(new Anthropic())
   */
  wrap<T extends object>(client: T, provider?: LlmProvider): T {
    return createCachedClientForProvider(client, this.manager, provider)
  }
}

@Module({})
export class LlmCacheModule {
  /**
   * @example
   * LlmCacheModule.forRoot({
   *   ttl: '24h',
   *   storage: 'redis',
   *   onStorageError: 'passthrough',
   * })
   */
  static forRoot(options: LlmCacheOptions): DynamicModule {
    return {
      module: LlmCacheModule,
      providers: [
        { provide: LLM_CACHE_OPTIONS, useValue: options },
        LlmCacheService,
      ],
      exports: [LlmCacheService],
      global: true,
    }
  }
}

/** Parameter decorator — injects LlmCacheService */
export const InjectLlmCache = (): ParameterDecorator => Inject(LlmCacheService)
