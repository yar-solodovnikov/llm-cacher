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
    this.keyAttr = opts.keyAttribute ?? 'pk'
    this.valueAttr = opts.valueAttribute ?? 'value'
    this.ttlAttr = opts.ttlAttribute ?? 'ttl'
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
    const ttl = ttlN ? Number(ttlN) * 1000 : null
    if (ttl !== null && Date.now() > ttl) return null

    return JSON.parse(item[this.valueAttr].S!) as CacheEntry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const item: Record<string, AttributeValue> = {
      [this.keyAttr]: { S: key },
      [this.valueAttr]: { S: JSON.stringify(entry) },
    }

    // DynamoDB TTL uses Unix seconds
    if (entry.expiresAt !== null) {
      item[this.ttlAttr] = { N: String(Math.floor(entry.expiresAt / 1000)) }
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
    const result = await this.client.send(new this.cmds.ScanCommand({
      TableName: this.table,
      ProjectionExpression: '#k',
      ExpressionAttributeNames: { '#k': this.keyAttr },
    }))

    const items = result.Items ?? []
    if (items.length === 0) return

    // DynamoDB BatchWrite limit is 25 items per request
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25).map(item => ({
        DeleteRequest: { Key: { [this.keyAttr]: item[this.keyAttr] } },
      }))
      await this.client.send(
        new this.cmds.BatchWriteItemCommand({ RequestItems: { [this.table]: batch } }),
      )
    }
  }
}
