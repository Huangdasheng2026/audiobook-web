const App = {
  books: [],
  currentBook: null,
  chapters: [],
  allSentences: [],
  currentChapter: 0,
  currentSentence: 0,
  sleepTimer: null,
  isPlayerMode: false,
  _sentenceCache: null,

  libStatus: {},
  _cdnBase: '',
  _pdfCdnBase: '',

  async init() {
    this._bindEvents()
    await DB.init()

    this._showLoading('正在加载解析库...')
    await this._loadLibs()
    this._hideLoading()

    if (window.pdfjsLib && this._pdfCdnBase) {
      const base = this._pdfCdnBase.replace(/\/[^/]+$/, '/')
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'
    }

    if (!this.libStatus.pdfjsLib) this._showError('PDF 解析库无法加载，暂不支持 PDF 格式')
    await this._renderBookshelf()
    TTS.init()
    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices()
      speechSynthesis.onvoiceschanged = () => TTS.init()
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {})
    }
  },

  async _loadLibs(forceReload = false) {
    const libs = [
      { name: 'pdfjsLib', urls: [
        'https://cdn.bootcdn.net/ajax/libs/pdf.js/4.9.155/pdf.min.js',
        'https://lib.baomitu.com/pdf.js/4.9.155/pdf.min.js',
        'https://cdn.staticfile.org/pdf.js/4.9.155/pdf.min.js',
        'https://npm.elemecdn.com/pdfjs-dist@4.9.155/build/pdf.min.js',
        'https://unpkg.zhimg.com/pdfjs-dist@4.9.155/build/pdf.min.js',
        'https://cdn.bootcdn.net/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.js',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        'https://unpkg.com/pdfjs-dist@4.9.155/build/pdf.min.js',
        'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        'https://cdnjs.loli.net/ajax/libs/pdf.js/4.9.155/pdf.min.js',
      ]},
      { name: 'mammoth', urls: [
        'https://cdn.bootcdn.net/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
        'https://lib.baomitu.com/mammoth/1.8.0/mammoth.browser.min.js',
        'https://cdn.staticfile.org/mammoth/1.8.0/mammoth.browser.min.js',
        'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
        'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
      ]},
      { name: 'JSZip', urls: [
        'https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js',
        'https://lib.baomitu.com/jszip/3.10.1/jszip.min.js',
        'https://cdn.staticfile.org/jszip/3.10.1/jszip.min.js',
        'https://cdn.bootcdn.net/ajax/libs/jszip/3.7.1/jszip.min.js',
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
        'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      ]},
    ]

    for (const lib of libs) {
      if (!forceReload && window[lib.name]) { this.libStatus[lib.name] = true; continue }
      let ok = false
      for (const url of lib.urls) {
        try {
          await this._loadLib(lib.name, url)
          if (window[lib.name]) {
            ok = true
            this._cdnBase = url
            if (lib.name === 'pdfjsLib') this._pdfCdnBase = url
            break
          }
        } catch (e) {}
      }
      this.libStatus[lib.name] = ok
    }
  },

  _loadLib(name, url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = url
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  },

  _bindEvents() {
    const dz = document.getElementById('drop-zone')
    const fi = document.getElementById('file-input')

    dz.addEventListener('click', () => fi.click())
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover') })
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'))
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dragover')
      if (e.dataTransfer.files[0]) this.addBook(e.dataTransfer.files[0])
    })
    fi.addEventListener('change', e => {
      const file = e.target.files[0]
      fi.value = ''
      if (file) this.addBook(file).catch(err => this._showError(err.message || '解析失败'))
    })

    document.getElementById('back-btn').addEventListener('click', () => this._showBookshelf())
    document.getElementById('play-btn').addEventListener('click', () => this.togglePlay())
    document.getElementById('prev-btn').addEventListener('click', () => this.prevSentence())
    document.getElementById('next-btn').addEventListener('click', () => this.nextSentence())

    document.querySelectorAll('.speed-btn').forEach(b => {
      b.addEventListener('click', () => this.setSpeed(parseFloat(b.dataset.speed)))
    })

    document.querySelectorAll('.timer-btn').forEach(b => {
      b.addEventListener('click', () => this._toggleTimer(parseInt(b.dataset.minutes)))
    })

    document.getElementById('cancel-timer').addEventListener('click', () => this._cancelTimer())
    const mobiLink = document.getElementById('mobi-url-btn')
    if (mobiLink) mobiLink.classList.add('hidden')

    const dbgBtn = document.getElementById('debug-books-btn')
    if (dbgBtn) dbgBtn.addEventListener('click', () => this._showDebugPanel('books'))
    const recBtn = document.getElementById('debug-recover-btn')
    if (recBtn) recBtn.addEventListener('click', () => this._showDebugPanel('recover'))
    const clrBtn = document.getElementById('debug-clear-btn')
    if (clrBtn) clrBtn.addEventListener('click', () => this._showDebugPanel('clear'))
    const closeBtn = document.getElementById('debug-close-btn')
    if (closeBtn) closeBtn.addEventListener('click', () => {
      const p = document.getElementById('debug-panel')
      if (p) p.style.display = 'none'
    })
  },

  async _showDebugPanel(mode) {
    const panel = document.getElementById('debug-panel')
    const content = document.getElementById('debug-content')
    if (!panel || !content) return
    panel.style.display = 'block'
    content.textContent = '加载中...'
    try {
      if (mode === 'books') {
        await this._renderBooksDebug(content)
      } else if (mode === 'clear') {
        await this._renderClearDebug(content)
      } else if (mode === 'recover') {
        await this._renderRecoverDebug(content)
      }
    } catch (e) {
      content.textContent = '诊断失败: ' + (e.message || e) + '\n' + (e.stack || '')
    }
  },

  async _renderBooksDebug(content) {
    const lines = []
    try {
      // 1. 浏览器存储信息
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate()
        lines.push('【存储用量】')
        lines.push('  已用: ' + (est.usage / 1024 / 1024).toFixed(2) + ' MB')
        lines.push('  配额: ' + (est.quota / 1024 / 1024).toFixed(2) + ' MB')
        lines.push('')
      }

      // 2. Service Worker 状态
      const swState = navigator.serviceWorker ? (navigator.serviceWorker.controller ? '已激活' : '等待激活') : '不支持'
      const cacheNames = await caches.keys()
      lines.push('【Service Worker】')
      lines.push('  状态: ' + swState)
      lines.push('  缓存: ' + (cacheNames.length ? cacheNames.join(', ') : '(无)'))
      lines.push('')

      // 3. IndexedDB 详细诊断
      lines.push('【IndexedDB 诊断】')
      lines.push('  数据库: AudiobookDB, 版本: ' + (DB._version || '?'))
      lines.push('  当前连接: ' + (DB._db ? '✓ 已连接' : '✗ 未连接（需重新 init）'))

      if (indexedDB.databases) {
        const dbs = await indexedDB.databases()
        lines.push('  浏览器中所有数据库: ' + (dbs.length ? dbs.map(d => d.name + '(v' + d.version + ')').join(', ') : '(无)'))
      }
      lines.push('')

      // 4. 尝试获取所有书籍
      let books = []
      try {
        books = await DB.getAllBooks()
      } catch (err) {
        lines.push('  ✗ getAllBooks 失败: ' + err.message)
        // 尝试重新初始化
        try {
          DB._db = null
          DB._initPromise = null
          await DB.init()
          books = await DB.getAllBooks()
          lines.push('  ✓ 重连后成功获取 ' + books.length + ' 本')
        } catch (err2) {
          lines.push('  ✗ 重连失败: ' + err2.message)
        }
      }

      lines.push('【书籍列表】共 ' + books.length + ' 本')
      lines.push('')

      if (!books.length) {
        lines.push('⚠️ 书架为空。可能原因：')
        lines.push('  1. 浏览器隐私/无痕模式（数据不持久）')
        lines.push('  2. 浏览器清理了站点数据/缓存')
        lines.push('  3. 上传时解析失败未保存')
        lines.push('  4. 数据库版本升级时数据丢失')
        lines.push('')
        lines.push('👉 建议：重新上传书籍（建议先上传 TXT 测试），')
        lines.push('   上传时打开 F12 控制台观察 [DB] 日志。')
      } else {
        books.forEach((b, i) => {
          lines.push('【' + (i + 1) + '】' + b.title)
          lines.push('  ID: ' + b.id)
          lines.push('  格式: ' + (b.format || '?') + '  章节: ' + (b.chapters ? b.chapters.length : 0) + '  句子: ' + (b.totalSentences || 0))
          lines.push('  进度: ' + (b.progressPercent || 0) + '%  更新: ' + new Date(b.updatedAt).toLocaleString())
          lines.push('')
        })
      }

      // PDF 解析诊断
      if (window._lastPdfStats) {
        const s = window._lastPdfStats
        lines.push('━━━ PDF 解析诊断 ━━━')
        lines.push('  总页数: ' + s.total)
        lines.push('  成功页: ' + s.success)
        lines.push('  空页: ' + s.empty)
        lines.push('  失败页: ' + s.fail)
        lines.push('  文本长度: ' + s.textLength + ' 字符')
        lines.push('  加载方式: ' + s.loadMethod)
        lines.push('  iOS 设备: ' + (s.isIOS ? '是' : '否'))
        lines.push('  CMap URL: ' + s.cMapUrl)
        if (s.firstFailPage > 0) {
          lines.push('  ⚠️ 首次失败页: ' + s.firstFailPage)
          lines.push('  ⚠️ 错误: ' + s.firstFailError)
        }
        if (s.fail > 0) {
          lines.push('')
          lines.push('👉 失败原因可能是 iOS Safari 的 PDF.js 兼容性问题。')
          lines.push('   建议: 用电脑 Chrome 打开同一个 PDF 看是否正常。')
        }
        lines.push('')
      }

      // 操作按钮
      lines.push('━━━ 操作 ━━━')
      lines.push('点击"恢复连接" → 强制重连数据库')
      lines.push('点击"导出备份" → 下载所有书籍为 JSON 文件')
      lines.push('点击"清空重建" → 删除所有数据后重建')
    } catch (e) {
      lines.push('诊断出错: ' + (e.message || e))
    }
    content.textContent = lines.join('\n')
  },

  async _renderRecoverDebug(content) {
    const lines = ['【恢复数据库连接】', '']
    try {
      // 关闭旧连接
      if (DB._db) {
        try { DB._db.close() } catch (e) {}
        lines.push('已关闭旧连接')
      }
      DB._db = null
      DB._initPromise = null

      // 重新初始化
      lines.push('正在重新打开数据库...')
      await DB.init()
      lines.push('✓ 数据库重连成功')

      // 列出所有 store
      const db = DB._db
      const stores = Array.from(db.objectStoreNames)
      lines.push('  Object Stores: ' + (stores.length ? stores.join(', ') : '(无)'))

      // 统计每 store 的记录数
      for (const storeName of stores) {
        await new Promise(r => {
          const tx = db.transaction(storeName, 'readonly')
          const req = tx.objectStore(storeName).count()
          req.onsuccess = () => {
            lines.push('  ' + storeName + ': ' + req.result + ' 条记录')
            r()
          }
          req.onerror = () => { lines.push('  ' + storeName + ': 统计失败'); r() }
        })
      }

      // 获取书籍
      const books = await DB.getAllBooks()
      lines.push('')
      lines.push('当前共有 ' + books.length + ' 本书籍')
      lines.push('')
      lines.push('✅ 恢复完成！请关闭此面板，刷新页面（Ctrl+F5）。')
    } catch (e) {
      lines.push('✗ 恢复失败: ' + (e.message || e))
    }
    content.textContent = lines.join('\n')
  },

  async _renderClearDebug(content) {
    const lines = ['【清空缓存与数据】', '']
    content.textContent = lines.join('\n')
    // 清空缓存
    const keys = await caches.keys()
    for (const k of keys) {
      await caches.delete(k)
      lines.push('已删除缓存: ' + k)
    }
    // 清空 IndexedDB
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases()
      for (const d of dbs) {
        if (d.name) {
          await new Promise(r => {
            const req = indexedDB.deleteDatabase(d.name)
            req.onsuccess = () => { lines.push('已删除数据库: ' + d.name); r() }
            req.onerror = () => { lines.push('删除数据库失败: ' + d.name); r() }
            req.onblocked = () => { lines.push('删除被阻塞: ' + d.name + ' (请关闭其他标签页)'); r() }
          })
        }
      }
    }
    // 注销 service worker
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const r of regs) {
        await r.unregister()
        lines.push('已注销 Service Worker')
      }
    }
    // 关闭 db 连接
    if (DB._db) {
      try { DB._db.close() } catch (e) {}
      DB._db = null
      DB._initPromise = null
    }
    lines.push('')
    lines.push('✅ 清理完成！请关闭此面板，然后刷新页面（Ctrl+F5）重新打开应用。')
    content.textContent = lines.join('\n')
  },

  // ===== Bookshelf =====

  async _renderBookshelf() {
    this._clearError()
    this.isPlayerMode = false
    TTS.stop()
    if (this.sleepTimer) { clearInterval(this.sleepTimer); this.sleepTimer = null }
    document.getElementById('upload-screen').classList.remove('hidden')
    document.getElementById('player-screen').classList.add('hidden')

    this.books = await DB.getAllBooks()
    const list = document.getElementById('bookshelf-list')
    const empty = document.getElementById('bookshelf-empty')

    if (!this.books.length) {
      list.innerHTML = ''; empty.classList.remove('hidden'); return
    }
    empty.classList.add('hidden')

    list.innerHTML = this.books.map(b => {
      const pct = b.progressPercent || 0
      const icon = b.icon || '📖'
      return `<div class="book-card" data-id="${b.id}">
        <div class="book-cover">${icon}</div>
        <div class="book-info">
          <div class="book-title">${this._esc(b.title)}</div>
          <div class="book-meta">${b.totalSentences || '--'} 句 · ${b.format}</div>
          <div class="book-progress">
            <div class="bp-track"><div class="bp-fill" style="width:${pct}%"></div></div>
            <span class="bp-text">${pct}%</span>
          </div>
        </div>
        <div class="book-action"><button class="delete-btn" data-action="delete" data-id="${b.id}">✕</button></div>
      </div>`
    }).join('')

    list.querySelectorAll('.book-card').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.dataset.action === 'delete') return
        this.openBook(el.dataset.id)
      })
    })
    list.querySelectorAll('.delete-btn').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation()
        if (confirm('删除这本书？')) { DB.deleteBook(b.dataset.id); this._renderBookshelf() }
      })
    })
  },

  async addBook(file) {
    this._clearError()
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['txt', 'pdf', 'epub', 'docx', 'mobi', 'azw3', 'prc', 'fb2'].includes(ext)) {
      this._showError('不支持 ' + ext + ' 格式（支持 TXT/PDF/EPUB/DOCX/MOBI/AZW3/FB2）'); return
    }

    // 解析库延迟加载：如果是 epub，先等 JSZip 加载完成；docx 等 mammoth；pdf 等 pdfjs
    if (ext === 'epub' || ext === 'docx' || ext === 'pdf') {
      if (ext === 'pdf' && !this.libStatus.pdfjsLib) {
        this._showLoading('正在加载 PDF 解析库...')
        await this._loadLibs(true)
        this._hideLoading()
        if (!this.libStatus.pdfjsLib) return this._showError('PDF 解析库不可用，请将 PDF 转换为 EPUB 后再上传')
      }
      if (ext === 'docx' && !this.libStatus.mammoth) {
        this._showLoading('正在加载 DOCX 解析库...')
        await this._loadLibs(true)
        this._hideLoading()
        if (!this.libStatus.mammoth) return this._showError('DOCX 解析库不可用')
      }
      if (ext === 'epub' && !this.libStatus.JSZip) {
        this._showLoading('正在加载 EPUB 解析库...')
        await this._loadLibs(true)
        this._hideLoading()
        if (!this.libStatus.JSZip) return this._showError('EPUB 解析库不可用')
      }
    }

    // 进度条辅助函数 - 必须立即可见
    const setProgress = (pct, msg) => {
      const bar = document.getElementById('upload-progress')
      const fill = document.getElementById('upload-progress-fill')
      const label = document.getElementById('upload-progress-label')
      if (bar) bar.classList.remove('hidden')
      const safePct = Math.max(2, Math.min(100, Math.round(pct * 100)))
      if (fill) fill.style.width = safePct + '%'
      if (label) label.textContent = (msg || '处理中...') + ' (' + safePct + '%)'
    }

    // 立即显示进度条，避免 0% 假象
    setProgress(0.02, '准备处理 ' + file.name)

    let ticker = null
    let stopped = false
    const stopTicker = () => { if (ticker) { clearInterval(ticker); ticker = null } stopped = true }

    try {
      // 后台独立 ticker，无论解析函数是否调用 onProgress 都会更新进度
      const startTime = Date.now()
      let syntheticPct = 0.02
      const parseStart = Date.now() + 600
      ticker = setInterval(() => {
        if (stopped) return
        const elapsed = (Date.now() - startTime) / 1000
        // 在 30 秒内从 2% 匀速增长到 85%
        syntheticPct = Math.min(0.85, 0.02 + (elapsed / 30) * 0.83)
        const remaining = Math.max(0, Math.round((Date.now() - parseStart) / 1000))
        setProgress(syntheticPct, '正在解析 ' + file.name + ' (' + elapsed.toFixed(1) + 's)')
      }, 200)

      setProgress(0.05, '正在读取文件 ' + file.name)

      const chapters = await PARSERS.parse(file, (msg, pct) => {
        if (stopped) return
        const realPct = 0.05 + (pct || 0) * 0.8
        if (realPct > syntheticPct) {
          syntheticPct = realPct
          setProgress(realPct, msg)
        }
      })

      stopTicker()
      setProgress(0.88, '正在分割句子...')
      await new Promise(r => setTimeout(r, 30))
      const sentences = chapters.reduce(function(sum, ch) { return sum + splitIntoSentences(ch.content).length }, 0)

      setProgress(0.95, '正在保存到书架...')
      const book = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: file.name.replace(/\.[^.]+$/, ''),
        format: '.' + ext,
        icon: '📖',
        chapters: chapters,
        currentChapter: 0,
        currentSentence: 0,
        totalSentences: sentences,
        progressPercent: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      await DB.saveBook(book)
      setProgress(1.0, '完成!')
      this._toast('✓ 添加成功')
      setTimeout(() => {
        const el = document.getElementById('upload-progress')
        if (el) el.classList.add('hidden')
      }, 600)
      await this._renderBookshelf()
    } catch (err) {
      stopTicker()
      console.error('addBook 失败:', err)
      const bar = document.getElementById('upload-progress')
      if (bar) bar.classList.add('hidden')
      this._showError('解析失败: ' + (err.message || err))
    }
  },

  async openBook(id) {
    this.currentBook = await DB.getBook(id)
    if (!this.currentBook) return this._toast('书籍不存在')

    this.chapters = this.currentBook.chapters || []
    this.currentChapter = this.currentBook.currentChapter || 0
    this.currentSentence = this.currentBook.currentSentence || 0
    this.isPlayerMode = true
    this._sentenceCache = null

    if (this.currentChapter >= this.chapters.length) this.currentChapter = 0
    this._loadChapterSentences()

    document.getElementById('upload-screen').classList.add('hidden')
    document.getElementById('player-screen').classList.remove('hidden')

    document.getElementById('book-name').textContent = this.currentBook.title
    document.getElementById('book-name-display').textContent = this.currentBook.title
    document.getElementById('book-meta').textContent =
      `${this.chapters.length} 章 · ${this.currentBook.totalSentences || '--'} 句`

    this._renderChapters()
    this._highlightSentence()
    this._updateSentenceCounter()
    document.getElementById('play-btn').textContent = '▶'
    document.getElementById('progress-fill').style.width = '0%'
    this._updateTimerDisplay()
  },

  _loadChapterSentences() {
    const ch = this.chapters[this.currentChapter]
    if (!ch) { this.allSentences = []; return }
    this.allSentences = splitIntoSentences(ch.content)
    if (this.currentSentence >= this.allSentences.length) this.currentSentence = 0
  },

  // ===== Chapters =====

  _renderChapters() {
    const list = document.getElementById('chapter-list')
    const status = document.getElementById('player-status')
    status.classList.add('hidden')

    list.innerHTML = this.chapters.map((ch, i) => `
      <div class="chapter-item ${i === this.currentChapter ? 'active' : ''}" data-idx="${i}">
        <div class="chapter-num">${i + 1}</div>
        <div class="chapter-text"><div class="chapter-name">${this._esc(ch.title)}</div></div>
        <div class="chapter-play">▶</div>
      </div>
    `).join('')

    list.querySelectorAll('.chapter-item').forEach(el => {
      el.addEventListener('click', () => this._switchChapter(parseInt(el.dataset.idx)))
    })
  },

  _switchChapter(idx) {
    if (idx === this.currentChapter) return
    TTS.stop()
    this.currentChapter = idx
    this.currentSentence = 0
    this._loadChapterSentences()
    this._renderChapters()
    this._highlightSentence()
    this._updateSentenceCounter()
    document.getElementById('play-btn').textContent = '▶'
    document.getElementById('progress-fill').style.width = '0%'
    this._saveProgress()
  },

  // ===== Player =====

  togglePlay() {
    if (TTS.isPlaying) {
      if (TTS.isPaused) { TTS.resume(); document.getElementById('play-btn').textContent = '⏸' }
      else { TTS.pause(); document.getElementById('play-btn').textContent = '▶' }
      return
    }

    if (!this.allSentences.length) return
    TTS.speakSentences(this.allSentences, this.currentSentence, {
      onSentenceChange: data => this._onSentenceChange(data),
      onEnd: () => this._onChapterEnd(),
    })
    document.getElementById('play-btn').textContent = '⏸'
  },

  _onSentenceChange(data) {
    if (data.done) return
    this.currentSentence = data.idx
    this._highlightSentence(data.text)
    this._updateSentenceCounter()
    this._saveProgress()
    if (data.paused !== undefined) return
  },

  _onChapterEnd() {
    document.getElementById('play-btn').textContent = '▶'
    document.getElementById('progress-fill').style.width = '100%'

    if (this.currentChapter + 1 < this.chapters.length) {
      this.currentSentence = 0
      this._switchChapter(this.currentChapter + 1)
    } else {
      this._toast('已读完')
      if (this.sleepTimer) this._cancelTimer()
    }
  },

  prevSentence() {
    if (this.currentSentence > 0) {
      this.currentSentence--
      if (TTS.isPlaying) {
        TTS.speakSentences(this.allSentences, this.currentSentence, {
          onSentenceChange: d => this._onSentenceChange(d),
          onEnd: () => this._onChapterEnd(),
        })
        document.getElementById('play-btn').textContent = '⏸'
      }
      this._highlightSentence()
      this._updateSentenceCounter()
    } else if (this.currentChapter > 0) {
      this._switchChapter(this.currentChapter - 1)
      this.currentSentence = this.allSentences.length - 1
      this._highlightSentence()
      this._updateSentenceCounter()
    }
  },

  nextSentence() {
    if (this.currentSentence < this.allSentences.length - 1) {
      this.currentSentence++
      if (TTS.isPlaying) {
        TTS.speakSentences(this.allSentences, this.currentSentence, {
          onSentenceChange: d => this._onSentenceChange(d),
          onEnd: () => this._onChapterEnd(),
        })
        document.getElementById('play-btn').textContent = '⏸'
      }
      this._highlightSentence()
      this._updateSentenceCounter()
    } else {
      this._onChapterEnd()
    }
  },

  setSpeed(rate) {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'))
    document.querySelector(`.speed-btn[data-speed="${rate}"]`)?.classList.add('active')
    TTS.setSpeed(rate)
  },

  // ===== Sentence Highlight =====

  _highlightSentence(text) {
    const container = document.getElementById('sentence-display')
    if (!container) return

    const idx = this.currentSentence

    if (text) {
      container.innerHTML = `<div class="sentence-highlight">${this._esc(text)}</div>`
      return
    }

    const s = this.allSentences[idx]
    if (s) {
      container.innerHTML = `<div class="sentence-highlight">${this._esc(s)}</div>`
    } else {
      container.innerHTML = `<div class="sentence-dim">—</div>`
    }
  },

  _updateSentenceCounter() {
    const el = document.getElementById('sentence-counter')
    if (el) {
      el.textContent = `${this.currentSentence + 1} / ${this.allSentences.length}`
    }
    const pct = this.allSentences.length
      ? Math.round((this.currentSentence / this.allSentences.length) * 100)
      : 0
    document.getElementById('progress-fill').style.width = pct + '%'
  },

  // ===== Sleep Timer =====

  _toggleTimer(minutes) {
    if (this.sleepTimer) {
      this._cancelTimer()
      return
    }

    const remaining = minutes * 60
    const el = document.getElementById('timer-display')
    el.textContent = `${minutes}:00`
    el.dataset.remaining = remaining
    document.getElementById('timer-bar').classList.remove('hidden')
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'))
    document.querySelector(`.timer-btn[data-minutes="${minutes}"]`)?.classList.add('active')

    this.sleepTimer = setInterval(() => {
      let sec = parseInt(el.dataset.remaining || '0')
      sec--
      if (sec <= 0) {
        this._cancelTimer()
        TTS.stop()
        document.getElementById('play-btn').textContent = '▶'
        this._toast('⏰ 定时关闭')
        return
      }
      el.dataset.remaining = sec
      const m = Math.floor(sec / 60)
      const s = sec % 60
      el.textContent = `${m}:${String(s).padStart(2, '0')}`
    }, 1000)
  },

  _cancelTimer() {
    if (this.sleepTimer) { clearInterval(this.sleepTimer); this.sleepTimer = null }
    document.getElementById('timer-bar').classList.add('hidden')
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'))
    document.getElementById('timer-display').textContent = '--:--'
  },

  _updateTimerDisplay() {
    const el = document.getElementById('timer-display')
    if (el) el.textContent = '--:--'
  },

  // ===== Persistence =====

  _cacheSentenceCounts() {
    if (this._sentenceCache) return
    const counts = this.chapters.map(ch => splitIntoSentences(ch.content).length)
    this._sentenceCache = {
      counts,
      allTotal: counts.reduce((a, b) => a + b, 0),
    }
  },

  async _saveProgress() {
    if (!this.currentBook) return
    this._cacheSentenceCounts()
    const { counts, allTotal } = this._sentenceCache
    let prevTotal = 0
    for (let i = 0; i < this.currentChapter; i++) {
      prevTotal += counts[i]
    }
    const globalSentence = prevTotal + this.currentSentence
    this.currentBook.totalSentences = allTotal
    this.currentBook.currentChapter = this.currentChapter
    this.currentBook.currentSentence = this.currentSentence
    this.currentBook.progressPercent = allTotal
      ? Math.round((globalSentence / allTotal) * 100)
      : 0
    this.currentBook.updatedAt = Date.now()
    await DB.saveBook(this.currentBook)
  },

  // ===== Navigation =====

  _showBookshelf() {
    TTS.stop()
    if (this.sleepTimer) this._cancelTimer()
    this.currentBook = null
    this._renderBookshelf()
  },

  // ===== Utils =====

  _showProgress(pct, msg) {
    const bar = document.getElementById('upload-progress')
    const fill = document.getElementById('upload-progress-fill')
    const label = document.getElementById('upload-progress-label')
    if (bar) bar.classList.remove('hidden')
    if (label) label.textContent = (msg || '处理中...') + ' (' + Math.round(pct * 100) + '%)'
    if (fill) {
      fill.style.width = Math.max(2, Math.round(pct * 100)) + '%'
      fill.style.background = 'linear-gradient(90deg, #4a9eff, #6c63ff)'
    }
  },

  _hideProgress() {
    const el = document.getElementById('upload-progress')
    const fill = document.getElementById('upload-progress-fill')
    if (fill) fill.style.width = '0%'
    if (el) el.classList.add('hidden')
  },

  _showLoading(msg) {
    let el = document.getElementById('loading-status')
    if (!el) {
      el = document.createElement('div')
      el.id = 'loading-status'
      el.className = 'loading-status'
      document.getElementById('upload-screen').appendChild(el)
    }
    el.textContent = '⏳ ' + msg
    el.classList.remove('hidden')
  },

  _hideLoading() {
    const el = document.getElementById('loading-status')
    if (el) el.classList.add('hidden')
  },

  _showError(msg) {
    this._hideProgress()
    let el = document.getElementById('error-status')
    if (!el) {
      el = document.createElement('div')
      el.id = 'error-status'
      el.className = 'error-status'
      document.getElementById('upload-screen').appendChild(el)
    }
    el.textContent = '❌ ' + msg
    el.classList.remove('hidden')
  },

  _clearError() {
    const el = document.getElementById('error-status')
    if (el) el.classList.add('hidden')
  },

  _toast(msg) {
    const old = document.querySelector('.toast')
    if (old) old.remove()
    const d = document.createElement('div'); d.className = 'toast'
    d.textContent = msg; document.body.appendChild(d)
    setTimeout(() => d.remove(), 3000)
  },

  _esc(s) {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML
  },
}

document.addEventListener('DOMContentLoaded', () => App.init())
