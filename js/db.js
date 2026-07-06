// Audiobook 数据库管理（IndexedDB + localStorage 兜底备份）
const DB = {
  _db: null,
  _initPromise: null,
  _opening: false,
  _version: 3,
  _BACKUP_KEY: 'audiobook_backup',

  async init() {
    if (this._db) return this._db
    if (this._initPromise) return this._initPromise

    this._opening = true
    this._initPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('AudiobookDB', this._version)

      req.onupgradeneeded = e => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('books')) {
          const store = db.createObjectStore('books', { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt', { unique: false })
        }
      }

      req.onsuccess = e => {
        this._db = e.target.result
        this._opening = false
        this._db.onversionchange = () => {
          try { this._db.close() } catch (err) {}
          this._db = null
          this._initPromise = null
        }
        this._db.onclose = () => {
          this._db = null
          this._initPromise = null
        }
        resolve(this._db)
      }

      req.onerror = e => {
        this._opening = false
        this._initPromise = null
        reject(e.target.error)
      }
    })

    return this._initPromise
  },

  async _ensure() {
    if (this._db) return this._db
    try {
      return await this.init()
    } catch (err) {
      throw new Error('数据库未就绪: ' + (err.message || err))
    }
  },

  _store(mode = 'readonly') {
    if (!this._db) throw new Error('数据库未初始化')
    const tx = this._db.transaction('books', mode)
    return tx.objectStore('books')
  },

  _request(store, method, arg) {
    return new Promise((resolve, reject) => {
      try {
        const req = store[method](arg)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      } catch (err) {
        reject(err)
      }
    })
  },

  async saveBook(book) {
    const db = await this._ensure()
    book.updatedAt = Date.now()
    if (!book.createdAt) book.createdAt = book.updatedAt

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('books', 'readwrite')
        const store = tx.objectStore('books')
        const req = store.put(book)

        req.onsuccess = async () => {
          try { await this._saveToLocalStorage(book) } catch (err) {}
          try {
            const saved = await this.getBook(book.id)
            if (saved) resolve(book)
            else reject(new Error('保存验证失败'))
          } catch (err) {
            resolve(book)
          }
        }
        req.onerror = e => reject(e.target.error)
        tx.onerror = e => reject(e.target.error)
        tx.onabort = () => reject(new Error('事务中止'))
      } catch (err) {
        reject(err)
      }
    })
  },

  async getBook(id) {
    const db = await this._ensure()
    return this._request(this._store(), 'get', id)
  },

  async getAllBooks() {
    const db = await this._ensure()
    let books = await this._request(this._store(), 'getAll')

    if (!books || books.length === 0) {
      try {
        const backup = await this._loadFromLocalStorage()
        if (backup && backup.length > 0) {
          for (const book of backup) {
            try { await this.saveBook(book) } catch (err) {}
          }
          books = backup
        }
      } catch (err) {}
    }

    return (books || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  },

  async deleteBook(id) {
    const db = await this._ensure()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite')
      tx.objectStore('books').delete(id)
      tx.oncomplete = async () => {
        try { await this._deleteFromLocalStorage(id) } catch (err) {}
        resolve()
      }
      tx.onerror = e => reject(e.target.error)
    })
  },

  async _debugList() {
    const db = await this._ensure()
    const books = await this._request(this._store(), 'getAll')
    return (books || []).map(b => ({
      id: b.id,
      title: b.title,
      format: b.format,
      chapterCount: (b.chapters || []).length,
      totalSentences: b.totalSentences,
      updatedAt: b.updatedAt,
      createdAt: b.createdAt,
    }))
  },

  async _saveToLocalStorage(book) {
    try {
      // 大小检查：localStorage 限制约 5MB，超过则跳过备份
      // （OCR 出的长书可能 12MB+，写入会抛 QuotaExceededError）
      const size = (book.chapters || []).reduce((s, ch) => s + (ch.content ? ch.content.length : 0), 0)
      if (size > 800000) {
        console.warn('[DB] 书籍太大(' + (size / 1024 / 1024).toFixed(1) + 'MB), 跳过 localStorage 备份')
        return
      }
      const data = localStorage.getItem(this._BACKUP_KEY)
      let books = data ? JSON.parse(data) : []
      const idx = books.findIndex(b => b.id === book.id)
      if (idx >= 0) books[idx] = book
      else books.push(book)
      if (books.length > 10) {
        books = books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 10)
      }
      localStorage.setItem(this._BACKUP_KEY, JSON.stringify(books))
    } catch (err) {
      // localStorage 失败不能影响主保存流程（IndexedDB 已成功）
      console.warn('[DB] localStorage 备份失败:', err && err.message)
    }
  },

  async _loadFromLocalStorage() {
    try {
      const data = localStorage.getItem(this._BACKUP_KEY)
      if (!data) return []
      const books = JSON.parse(data)
      return books || []
    } catch (err) {
      return []
    }
  },

  async _deleteFromLocalStorage(id) {
    try {
      const data = localStorage.getItem(this._BACKUP_KEY)
      if (!data) return
      let books = JSON.parse(data) || []
      books = books.filter(b => b.id !== id)
      localStorage.setItem(this._BACKUP_KEY, JSON.stringify(books))
    } catch (err) {
      throw err
    }
  },
}

if (typeof window !== 'undefined') window.DB = DB
