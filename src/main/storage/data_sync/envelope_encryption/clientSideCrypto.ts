import CryptoUtils from './utils/crypto'
import { StorageManager } from './utils/storage'
import ApiClient from './services/apiClient'

interface EncryptionResult {
  encrypted: string
  algorithm: string
  iv?: string
  tag?: string
}

interface ClientStatus {
  initialized: boolean
  userId: string | null
  sessionId: string | null
  hasValidKey: boolean
}

interface DataKeyCache {
  encryptedDataKey: string
  plaintextDataKey: Buffer
  encryptionContext: any
  timestamp: number
}

interface CacheStats {
  totalRequests: number
  cacheHits: number
  cacheMisses: number
  hitRate: number
}

/**
 * 客户端加密库 - 核心类
 *
 * 安全架构：
 * 1. 数据不离开客户端：所有敏感数据在客户端加密
 * 2. 密钥分离：主密钥在KMS，数据密钥临时下发
 * 3. 零信任：服务端无法看到用户数据
 * 4. 密钥轮换：支持定期更换数据密钥
 * 5. 安全存储：只存储加密后的数据密钥
 */
class ClientSideCrypto {
  private apiClient: any
  private storage: any
  private dataKey: Buffer | null = null
  private encryptedDataKey: string | null = null
  private userId: string | null = null
  private sessionId: string | null = null
  private authToken: string | null = null

  // 数据密钥缓存机制
  private dataKeyCache: Map<string, DataKeyCache> = new Map()
  private cacheStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0
  }
  private readonly CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24小时过期
  private readonly MAX_CACHE_SIZE = 100 // 最大缓存条目数

  constructor(serverUrl: string) {
    this.apiClient = new ApiClient(serverUrl)
    this.storage = new StorageManager()
  }

  /**
   * 初始化客户端加密
   * @param userId - 用户ID
   * @param authToken - 认证令牌（可选）
   */
  async initialize(userId: string, authToken: string | null = null): Promise<void> {
    try {
      this.userId = userId
      this.authToken = authToken // 保存认证令牌

      // 首先尝试恢复会话ID
      const storedSessionId = await this.storage.getSession(userId)
      if (storedSessionId) {
        this.sessionId = storedSessionId
      } else {
        this.sessionId = CryptoUtils.generateSessionId()
      }

      // 直接生成新的数据密钥，不再依赖本地存储
      await this.generateNewDataKey()

      // 存储会话信息
      await this.storage.storeSession(userId, this.sessionId)

      console.log('客户端加密初始化完成')
    } catch (error) {
      // 简化错误日志，避免重复输出
      const errorMessage = (error as Error).message
      throw new Error(`客户端加密初始化失败: ${errorMessage}`)
    }
  }

  /**
   * 解密数据密钥（使用内存缓存机制）
   * @param encryptedDataKey - 加密的数据密钥
   * @param encryptionContext - 加密上下文
   * @returns 解密后的数据密钥
   */
  private async decryptDataKey(encryptedDataKey: string, encryptionContext: any): Promise<Buffer> {
    try {
      console.log('开始解密数据密钥...')

      // 尝试从内存缓存获取数据密钥
      const cachedKey = await this.getDataKeyFromCache(encryptedDataKey, encryptionContext)
      if (cachedKey) {
        console.log('从内存缓存获取数据密钥成功')
        return cachedKey
      }

      // 缓存未命中，直接调用KMS服务解密数据密钥
      console.log(' 缓存未命中，调用KMS解密数据密钥...')
      const response = await this.apiClient.decryptDataKey({
        encryptedDataKey,
        encryptionContext,
        authToken: this.authToken
      })

      if (response.success) {
        // 将Base64编码的密钥转换为Buffer
        const plaintextDataKey = Buffer.from(response.plaintextDataKey, 'base64')

        // 将解密结果添加到内存缓存
        await this.addDataKeyToCache(encryptedDataKey, encryptionContext, plaintextDataKey)

        console.log(' 数据密钥解密成功并已缓存')
        return plaintextDataKey
      } else {
        throw new Error(`解密数据密钥失败: ${response.error}`)
      }
    } catch (error) {
      // 简化错误日志输出
      const errorMessage = (error as Error).message
      console.warn('数据密钥解密失败:', errorMessage)
      throw new Error(errorMessage.includes('解密数据密钥失败') ? errorMessage : `解密数据密钥失败: ${errorMessage}`)
    }
  }

  /**
   *  生成新的数据密钥
   */
  private async generateNewDataKey(): Promise<void> {
    try {
      // 构建加密上下文
      const encryptionContext = {
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp: Date.now().toString(),
        purpose: 'client-side-encryption'
      }

      // 调用KMS服务生成数据密钥
      const response = await this.apiClient.generateDataKey({
        encryptionContext,
        authToken: this.authToken
      })

      if (response.success) {
        // 将Base64编码的密钥转换为Buffer
        this.dataKey = Buffer.from(response.plaintextDataKey, 'base64')
        this.encryptedDataKey = response.encryptedDataKey

        // 将新生成的密钥添加到内存缓存
        if (this.encryptedDataKey && this.dataKey) {
          await this.addDataKeyToCache(this.encryptedDataKey, encryptionContext, this.dataKey)
        }

        console.log('✅ 新数据密钥生成成功并已缓存')
      } else {
        throw new Error(`生成数据密钥失败: ${response.error}`)
      }
    } catch (error) {
      // 简化错误日志输出
      const errorMessage = (error as Error).message
      console.warn('数据密钥生成失败:', errorMessage)
      throw new Error(errorMessage.includes('生成数据密钥失败') ? errorMessage : `生成数据密钥失败: ${errorMessage}`)
    }
  }

  /**
   * 使用 AWS Encryption SDK 加密敏感数据
   * @param plaintext - 要加密的明文数据
   * @returns 加密结果
   */
  async encryptData(plaintext: string): Promise<EncryptionResult> {
    if (!this.dataKey || !this.userId) {
      throw new Error('客户端加密未初始化')
    }

    console.log('开始加密数据...')

    const dataKeyBase64 = this.dataKey.toString('base64')

    const result: EncryptionResult = await CryptoUtils.encryptDataWithAwsSdk(plaintext, dataKeyBase64, this.userId!)

    return result
  }

  /**
   * 使用 AWS Encryption SDK 解密敏感数据
   * @param encryptedData - 加密的数据对象
   * @returns 解密后的明文
   */
  async decryptData(encryptedData: EncryptionResult): Promise<string> {
    if (!this.dataKey || !this.userId) {
      throw new Error('客户端加密未初始化')
    }

    console.log('开始解密数据...')

    const dataKeyBase64 = this.dataKey.toString('base64')

    return await CryptoUtils.decryptDataWithAwsSdk(encryptedData, dataKeyBase64)
  }

  /**
   * 轮换数据密钥
   */
  async rotateDataKey(): Promise<void> {
    if (!this.userId) {
      throw new Error('未设置用户ID')
    }

    try {
      console.log('开始轮换数据密钥...')

      // 清理当前密钥
      this.clearDataKey()

      // 生成新的会话ID
      this.sessionId = CryptoUtils.generateSessionId()

      // 生成新的数据密钥
      await this.generateNewDataKey()

      console.log('数据密钥轮换成功')
    } catch (error) {
      console.error('数据密钥轮换失败:', error)
      throw error
    }
  }

  /**
   *  清理内存中的敏感数据
   * @param clearSession - 是否同时清理会话信息
   */
  cleanup(clearSession: boolean = false): void {
    console.log('清理客户端加密资源...')

    // 清理内存中的敏感数据
    this.clearDataKey()
    this.encryptedDataKey = null
    this.authToken = null

    // 清理数据密钥缓存
    this.clearCache(true)

    if (clearSession && this.userId) {
      // 只清理会话信息，不再管理本地数据密钥存储
      this.storage.clearSession(this.userId)
      console.log('已清理会话信息')
    }

    console.log(' 资源清理完成')
  }

  /**
   *  安全清理数据密钥
   */
  private clearDataKey(): void {
    if (this.dataKey) {
      // 用随机数据覆盖密钥内存
      this.dataKey.fill(0)
      this.dataKey = null
    }
  }

  /**
   * 获取客户端状态
   */
  getStatus(): ClientStatus {
    return {
      initialized: !!this.dataKey,
      userId: this.userId,
      sessionId: this.sessionId,
      hasValidKey: !!this.dataKey
    }
  }

  /**
   * 健康检查
   * @returns 客户端加密服务的健康状态
   */
  async healthCheck(): Promise<any> {
    try {
      const status = this.getStatus()
      const cacheStats = this.getCacheStats()

      return {
        client: {
          status: 'healthy',
          initialized: status.initialized,
          hasValidKey: status.hasValidKey,
          userId: status.userId,
          sessionId: status.sessionId
        },
        cache: {
          ...cacheStats,
          size: this.dataKeyCache.size,
          maxSize: this.MAX_CACHE_SIZE
        },
        api: {
          available: !!this.apiClient,
          serverUrl: this.apiClient?.serverUrl || 'unknown'
        }
      }
    } catch (error) {
      return {
        client: {
          status: 'error',
          error: (error as Error).message,
          initialized: false
        }
      }
    }
  }

  /**
   * 从缓存获取数据密钥
   * @param encryptedDataKey - 加密的数据密钥
   * @param encryptionContext - 加密上下文
   * @returns 缓存的明文数据密钥，如果未找到则返回null
   */
  private async getDataKeyFromCache(encryptedDataKey: string, encryptionContext: any): Promise<Buffer | null> {
    this.cacheStats.totalRequests++

    // 生成缓存键
    const cacheKey = this.generateCacheKey(encryptedDataKey, encryptionContext)
    const cached = this.dataKeyCache.get(cacheKey)

    if (!cached) {
      this.cacheStats.cacheMisses++
      return null
    }

    // 检查缓存是否过期
    if (Date.now() - cached.timestamp > this.CACHE_EXPIRY_MS) {
      console.log(' 缓存已过期，移除缓存条目')
      this.dataKeyCache.delete(cacheKey)
      this.cacheStats.cacheMisses++
      return null
    }

    // 验证加密上下文是否匹配
    if (!this.compareEncryptionContext(cached.encryptionContext, encryptionContext)) {
      console.warn('⚠️加密上下文不匹配，跳过缓存')
      this.cacheStats.cacheMisses++
      return null
    }

    this.cacheStats.cacheHits++
    console.log(`📊 缓存命中率: ${((this.cacheStats.cacheHits / this.cacheStats.totalRequests) * 100).toFixed(2)}%`)

    return cached.plaintextDataKey
  }

  /**
   * 将数据密钥添加到缓存
   * @param encryptedDataKey - 加密的数据密钥
   * @param encryptionContext - 加密上下文
   * @param plaintextDataKey - 明文数据密钥
   */
  private async addDataKeyToCache(encryptedDataKey: string, encryptionContext: any, plaintextDataKey: Buffer): Promise<void> {
    try {
      // 检查缓存大小限制
      if (this.dataKeyCache.size >= this.MAX_CACHE_SIZE) {
        this.evictOldestCacheEntry()
      }

      const cacheKey = this.generateCacheKey(encryptedDataKey, encryptionContext)

      // 创建密钥副本以避免原始密钥被修改
      const keyBuffer = Buffer.alloc(plaintextDataKey.length)
      plaintextDataKey.copy(keyBuffer)

      const cacheEntry: DataKeyCache = {
        encryptedDataKey,
        plaintextDataKey: keyBuffer,
        encryptionContext: { ...encryptionContext }, // 深拷贝
        timestamp: Date.now()
      }

      this.dataKeyCache.set(cacheKey, cacheEntry)
      console.log(`💾 数据密钥已添加到缓存，当前缓存大小: ${this.dataKeyCache.size}`)
    } catch (error) {
      console.warn('添加缓存失败:', (error as Error).message)
      // 缓存失败不应该影响主要功能
    }
  }

  /**
   * 生成缓存键
   * @param encryptedDataKey - 加密的数据密钥
   * @param encryptionContext - 加密上下文
   * @returns 缓存键
   */
  private generateCacheKey(encryptedDataKey: string, encryptionContext: any): string {
    // 使用加密数据密钥的哈希作为主键，加密上下文作为辅助键
    const crypto = require('crypto')
    const contextStr = JSON.stringify(encryptionContext, Object.keys(encryptionContext).sort())
    const combined = `${encryptedDataKey}:${contextStr}`
    return crypto.createHash('sha256').update(combined).digest('hex')
  }

  /**
   * 比较两个加密上下文是否相等
   * @param context1 - 第一个加密上下文
   * @param context2 - 第二个加密上下文
   * @returns 是否相等
   */
  private compareEncryptionContext(context1: any, context2: any): boolean {
    try {
      const str1 = JSON.stringify(context1, Object.keys(context1 || {}).sort())
      const str2 = JSON.stringify(context2, Object.keys(context2 || {}).sort())
      return str1 === str2
    } catch (error) {
      console.warn('比较加密上下文失败:', (error as Error).message)
      return false
    }
  }

  /**
   * 清除最旧的缓存条目
   */
  private evictOldestCacheEntry(): void {
    let oldestKey: string | null = null
    let oldestTimestamp = Date.now()

    // 使用 Array.from 转换 Map 迭代器以兼容不同的 TypeScript 目标版本
    const entries = Array.from(this.dataKeyCache.entries())
    for (const [key, entry] of entries) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      const entry = this.dataKeyCache.get(oldestKey)
      if (entry) {
        // 安全清理密钥内存
        entry.plaintextDataKey.fill(0)
      }
      this.dataKeyCache.delete(oldestKey)
      console.log('🗑️ 已清除最旧的缓存条目')
    }
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计信息
   */
  getCacheStats(): CacheStats {
    const hitRate = this.cacheStats.totalRequests > 0 ? (this.cacheStats.cacheHits / this.cacheStats.totalRequests) * 100 : 0

    return {
      totalRequests: this.cacheStats.totalRequests,
      cacheHits: this.cacheStats.cacheHits,
      cacheMisses: this.cacheStats.cacheMisses,
      hitRate: Number(hitRate.toFixed(2))
    }
  }

  /**
   * 清理缓存
   * @param clearStats - 是否同时清理统计信息
   */
  clearCache(clearStats: boolean = false): void {
    // 安全清理所有缓存的密钥
    // 使用 Array.from 转换 Map 迭代器以兼容不同的 TypeScript 目标版本
    const entries = Array.from(this.dataKeyCache.values())
    for (const entry of entries) {
      entry.plaintextDataKey.fill(0)
    }

    this.dataKeyCache.clear()

    if (clearStats) {
      this.cacheStats = {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0
      }
    }

    console.log('🧹 数据密钥缓存已清理')
  }
}

export default ClientSideCrypto
export { ClientSideCrypto }
export type { EncryptionResult, ClientStatus, DataKeyCache, CacheStats }
