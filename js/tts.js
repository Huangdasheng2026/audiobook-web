const TTS = {
  synth: window.speechSynthesis,
  utterance: null,
  voice: null,
  voices: [],

  sentences: [],
  currentIdx: 0,
  isPlaying: false,
  isPaused: false,
  speed: 1,

  onSentenceChange: null,
  onEnd: null,
  onPauseState: null,
  onVoicesChanged: null,

  _savedVoiceURI: null,
  _savedCategory: null,
  _voiceListKey: 'tts-voice-uri',
  _voiceCategoryKey: 'tts-voice-category',

  CATEGORIES: {
    female: '女声',
    male: '男声',
    child: '儿童',
    'mature-male': '成熟男声',
  },

  init() {
    // 读取用户保存的选择
    try {
      this._savedVoiceURI = localStorage.getItem(this._voiceListKey) || null
      this._savedCategory = localStorage.getItem(this._voiceCategoryKey) || null
    } catch (e) {}

    // 加载 voice 列表（不同浏览器时机不同，Chrome 通常首次为空，需要 onvoiceschanged）
    const tryLoad = () => {
      const vs = this.synth.getVoices()
      if (vs && vs.length) {
        this.voices = vs
        this._applyVoice()
        if (this.onVoicesChanged) this.onVoicesChanged(vs)
        return true
      }
      return false
    }
    if (!tryLoad()) {
      this.synth.onvoiceschanged = () => {
        if (tryLoad()) this.synth.onvoiceschanged = null
      }
      // 兜底：500ms 后再试一次
      setTimeout(() => tryLoad(), 500)
    }
  },

  _applyVoice() {
    // 如果有保存的分类，优先按分类选
    if (this._savedCategory) {
      const v = this._getVoiceByCategory(this._savedCategory)
      if (v) { this.voice = v; return }
    }
    // 优先用用户保存的具体 URI
    if (this._savedVoiceURI) {
      const found = this.voices.find(v => v.voiceURI === this._savedVoiceURI)
      if (found) { this.voice = found; return }
    }
    // 智能默认：女声优先
    this.voice = this._getVoiceByCategory('female')
      || this.voices.find(v => v.lang.startsWith('zh'))
      || this.voices[0] || null
  },

  _getVoiceByCategory(category) {
    const vs = this.voices || []
    if (!vs.length) return null
    const n = v => v.name.toLowerCase()
    const isZH = v => /^zh/i.test(v.lang)
    const zh = vs.filter(isZH)
    const pool = zh.length ? zh : vs

    let scoreFn = null
    if (category === 'female') {
      scoreFn = v => {
        const name = n(v)
        if (/xiaoxiao|xiaoyi/.test(name)) return 100
        if (/female|girl|女/.test(name)) return 80
        if (/xiaochen|xiaomeng|xiaoxuan|xiaoyu|xiaoshuang|xiaomo/.test(name)) return 70
        if (/yunye|yunxi|yunyang|yunjian/.test(name)) return 0
        return 40
      }
    } else if (category === 'male') {
      scoreFn = v => {
        const name = n(v)
        if (/yunxi|yunyang/.test(name)) return 100
        if (/male|boy|男/.test(name)) return 80
        if (/yunye|yunjian/.test(name)) return 50
        if (/xiaoxiao|xiaoyi/.test(name)) return 0
        return 40
      }
    } else if (category === 'child') {
      scoreFn = v => {
        const name = n(v)
        if (/child|kid|children|童/.test(name)) return 100
        if (/xiaoxiao|xiaoyi|female|girl|女/.test(name)) return 60
        return 20
      }
    } else if (category === 'mature-male') {
      scoreFn = v => {
        const name = n(v)
        if (/yunjian|yunye/.test(name)) return 100
        if (/yunxi|yunyang/.test(name)) return 70
        if (/male|boy|男/.test(name)) return 60
        if (/xiaoxiao|xiaoyi/.test(name)) return 0
        return 40
      }
    }
    if (!scoreFn) return pool[0]
    const scored = pool.map(v => ({ v, s: scoreFn(v) })).sort((a, b) => b.s - a.s)
    return scored[0] && scored[0].s > 0 ? scored[0].v : pool[0]
  },

  setVoice(voiceURI) {
    const found = this.voices.find(v => v.voiceURI === voiceURI)
    if (!found) return false
    this.voice = found
    try { localStorage.setItem(this._voiceListKey, voiceURI) } catch (e) {}
    this._savedVoiceURI = voiceURI
    this._resumeIfPlaying()
    return true
  },

  setVoiceCategory(category) {
    const voice = this._getVoiceByCategory(category)
    if (!voice) return false
    this.voice = voice
    try { localStorage.setItem(this._voiceCategoryKey, category) } catch (e) {}
    this._savedCategory = category
    this._resumeIfPlaying()
    return true
  },

  getCurrentCategory() {
    return this._savedCategory || 'female'
  },

  _resumeIfPlaying() {
    if (this.isPlaying) {
      const cur = this.currentIdx
      const playing = !this.isPaused
      this.synth.cancel()
      this.currentIdx = cur
      this.isPlaying = false
      this.isPaused = false
      this._playCurrent()
      if (!playing) this.pause()
    }
  },

  // 按语言分类（中文优先）
  getVoicesGrouped() {
    const vs = this.voices || []
    const zhCN = vs.filter(v => v.lang.toLowerCase().startsWith('zh-cn'))
    const zh = vs.filter(v => /^zh/i.test(v.lang) && !v.lang.toLowerCase().startsWith('zh-cn'))
    const en = vs.filter(v => v.lang.toLowerCase().startsWith('en'))
    const other = vs.filter(v => !/^(zh|en)/i.test(v.lang))
    return { zhCN, zh, en, other }
  },

  speakSentences(sentences, startIdx = 0, { onSentenceChange, onEnd } = {}) {
    this.stop()
    this.sentences = sentences
    this.currentIdx = startIdx
    this.onSentenceChange = onSentenceChange
    this.onEnd = onEnd
    this._playCurrent()
  },

  _playCurrent() {
    if (this.currentIdx >= this.sentences.length) {
      this.isPlaying = false
      this.onSentenceChange?.({ idx: -1, done: true })
      this.onEnd?.()
      return
    }

    if (!this.voice) this.init()
    const text = this.sentences[this.currentIdx]
    if (!text.trim()) {
      this.currentIdx++
      this._playCurrent()
      return
    }

    const u = new SpeechSynthesisUtterance(text)
    u.voice = this.voice
    u.rate = this.speed
    u.lang = (this.voice && this.voice.lang) || 'zh-CN'

    u.onstart = () => {
      this.isPlaying = true
      this.isPaused = false
      this.onSentenceChange?.({ idx: this.currentIdx, text, playing: true })
    }

    u.onend = () => {
      this.currentIdx++
      this._playCurrent()
    }

    u.onerror = () => {
      this.currentIdx++
      this._playCurrent()
    }

    this.utterance = u
    this.synth.speak(u)
  },

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.synth.pause()
      this.isPaused = true
      this.onSentenceChange?.({ idx: this.currentIdx, paused: true })
    }
  },

  resume() {
    if (this.isPaused) {
      this.synth.resume()
      this.isPaused = false
      this.onSentenceChange?.({ idx: this.currentIdx, paused: false })
    }
  },

  stop() {
    this.synth.cancel()
    this.isPlaying = false
    this.isPaused = false
    this.currentIdx = 0
    this.sentences = []
    this.utterance = null
  },

  setSpeed(rate) {
    this.speed = rate
    if (this.isPlaying && this.utterance) {
      this.utterance.rate = rate
    }
  },

  getProgress() {
    return this.sentences.length
      ? Math.min(this.currentIdx / this.sentences.length, 1)
      : 0
  },
}
