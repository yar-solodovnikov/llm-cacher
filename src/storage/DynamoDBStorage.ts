import type {
  DynamoDBClient,
  DynamoDBClientConfig,
  AttributeValue,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb'
import type { CacheEntry, IStorage } from './IStorage'
import { ENTRY_TYPE_FULL, ENTRY_TYPE_STREAM } from './IStorage'

type DynamoCommands = {
  GetItemCommand: typeof GetItemCommand
  PutItemCommand: typeof PutItemCommand
  DeleteItemCommand: typeof DeleteItemCommand
  ScanCommand: typeof ScanCommand
  BatchWriteItemCommand: typeof BatchWriteItemCommand
}

export interface DynamoDBStorageOptions {
  tableName: string
  region?: string
  client?: DynamoDBClient
  config?: DynamoDBClientConfig
  keyAttribute?: string
  valueAttribute?: string
  ttlAttribute?: string
}

const DEFAULT_KEY_ATTRIBUTE = 'pk'
const DEFAULT_VALUE_ATTRIBUTE = 'value'
const DEFAULT_TTL_ATTRIBUTE = 'ttl'
const DYNAMODB_BATCH_WRITE_LIMIT = 25
const DYNAMO_KEY_ALIAS = '#k'
const MS_PER_SECOND = 1_000

export class DynamoDBStorage implements IStorage {
  private client: DynamoDBClient
  private cmds: DynamoCommands
  private readonly table: string
  private readonly keyAttr: string
  private readonly valueAttr: string
  private readonly ttlAttr: string

  constructor(opts: DynamoDBStorageOptions) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@aws-sdk/client-dynamodb') as typeof import('@aws-sdk/client-dynamodb')
    this.cmds = sdk
    this.client = opts.client ?? new sdk.DynamoDBClient({ region: opts.region, ...opts.config })
    this.table = opts.tableName
    this.keyAttr = opts.keyAttribute ?? DEFAULT_KEY_ATTRIBUTE
    this.valueAttr = opts.valueAttribute ?? DEFAULT_VALUE_ATTRIBUTE
    this.ttlAttr = opts.ttlAttribute ?? DEFAULT_TTL_ATTRIBUTE
  }

  async get(key: string): Promise<CacheEntry | null> {
    const result = await this.client.send(
      new this.cmds.GetItemCommand({
        TableName: this.table,
        Key: { [this.keyAttr]: { S: key } },
      }),
    )

    const item = result.Item
    if (!item || !item[this.valueAttr]?.S) return null

    // DynamoDB TTL cleanup is eventual — do a client-side check too
    const ttlN = item[this.ttlAttr]?.N
    const ttl = ttlN ? Number(ttlN) * MS_PER_SECOND : null
    if (ttl !== null && Date.now() > ttl) return null

    const entry = JSON.parse(item[this.valueAttr].S!) as CacheEntry
    if (entry.type !== ENTRY_TYPE_FULL && entry.type !== ENTRY_TYPE_STREAM) return null
    return entry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const item: Record<string, AttributeValue> = {
      [this.keyAttr]: { S: key },
      [this.valueAttr]: { S: JSON.stringify(entry) },
    }

    // DynamoDB TTL uses Unix seconds
    if (entry.expiresAt !== null) {
      item[this.ttlAttr] = { N: String(Math.floor(entry.expiresAt / MS_PER_SECOND)) }
    }

    await this.client.send(new this.cmds.PutItemCommand({ TableName: this.table, Item: item }))
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new this.cmds.DeleteItemCommand({
        TableName: this.table,
        Key: { [this.keyAttr]: { S: key } },
      }),
    )
  }

  async clear(): Promise<void> {
    let lastKey: Record<string, AttributeValue> | undefined

    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await this.client.send(new this.cmds.ScanCommand({
        TableName: this.table,
        ProjectionExpression: DYNAMO_KEY_ALIAS,
        ExpressionAttributeNames: { [DYNAMO_KEY_ALIAS]: this.keyAttr },
        ExclusiveStartKey: lastKey,
      }))

      const items: Record<string, AttributeValue>[] = result.Items ?? []
      for (let i = 0; i < items.length; i += DYNAMODB_BATCH_WRITE_LIMIT) {
        let requestItems = items.slice(i, i + DYNAMODB_BATCH_WRITE_LIMIT).map(item => ({
          DeleteRequest: { Key: { [this.keyAttr]: item[this.keyAttr] } },
        }))
        // Retry until DynamoDB has processed every item (capacity throttle can leave UnprocessedItems)
        while (requestItems.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const batchResult: any = await this.client.send(
            new this.cmds.BatchWriteItemCommand({ RequestItems: { [this.table]: requestItems } }),
          )
          requestItems = batchResult.UnprocessedItems?.[this.table] ?? []
        }
      }

      lastKey = result.LastEvaluatedKey as Record<string, AttributeValue> | undefined
    } while (lastKey !== undefined)
  }
}
