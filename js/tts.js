const TTS = {
  synth: window.speechSynthesis,
  utterance: null,
  voice: null,

  sentences: [],
  currentIdx: 0,
  isPlaying: false,
  isPaused: false,
  speed: 1,

  onSentenceChange: null,
  onEnd: null,
  onPauseState: null,

  init() {
    if (this.voice) return
    const voices = this.synth.getVoices()
    this.voice = voices.find(v => v.voiceURI?.includes('Xiaoxiao'))
      || voices.find(v => v.lang.startsWith('zh') && v.name.includes('Natural'))
      || voices.find(v => v.lang.startsWith('zh') && /female|girl/i.test(v.name))
      || voices.find(v => v.lang.startsWith('zh'))
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

    this.init()
    const text = this.sentences[this.currentIdx]
    if (!text.trim()) {
      this.currentIdx++
      this._playCurrent()
      return
    }

    const u = new SpeechSynthesisUtterance(text)
    u.voice = this.voice
    u.rate = this.speed
    u.lang = 'zh-CN'

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
