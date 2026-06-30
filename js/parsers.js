function decompressPalmDoc(data) {
  var out = []
  var i = 0
  var MAX = 8000000

  while (i < data.length && out.length < MAX) {
    var b = data[i]

    if (b === 0) {
      out.push(10)
      i++
    } else if (b >= 1 && b <= 8) {
      i++
      for (var j = 0; j < b && i < data.length && out.length < MAX; j++, i++) {
        out.push(data[i])
      }
    } else if (b >= 9 && b <= 127) {
      out.push(b)
      i++
    } else if (b >= 128 && b <= 191) {
      i++
      var next = i < data.length ? data[i] : 0x20
      var spaces = ((b & 0x3F) << 8) | next
      var count = Math.min(Math.max(1, spaces), 10000)
      for (var s = 0; s < count && out.length < MAX; s++) out.push(0x20)
      i++
    } else if (b >= 192 && b <= 255) {
      var n
      var dist
      if (b < 208) {
        n = b - 192
        dist = (i + 1 < data.length ? data[i + 1] : 0)
        i += 2
      } else {
        n = ((b - 208) << 8) | (i + 1 < data.length ? data[i + 1] : 0)
        dist = (i + 2 < data.length ? data[i + 2] : 0)
        i += 3
      }
      var len = n + 1
      var start = out.length - dist
      if (start >= 0 && start < out.length) {
        for (var j = 0; j < len && out.length < MAX; j++) {
          var idx = start + j
          if (idx >= 0 && idx < out.length) {
            out.push(out[idx])
          }
        }
      }
    } else {
      i++
    }
  }

  return new Uint8Array(out)
}

// 尝试多种编码解码，返回最佳结果（中文优先）
function decodeBytes(bytes) {
  if (!bytes || !bytes.length) return ''

  // 1) 优先尝试 UTF-8（带 BOM 检查）
  var hasBOM = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
  if (hasBOM) {
    try {
      var s = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3))
      if (s && s.length > 0) return s
    } catch (e) {}
  }

  // 2) 统计可打印 ASCII 比例
  var printable = 0
  for (var i = 0; i < Math.min(bytes.length, 4096); i++) {
    var c = bytes[i]
    if ((c >= 0x20 && c <= 0x7E) || c === 0x0A || c === 0x0D || c === 0x09) printable++
  }
  var sample = Math.min(bytes.length, 4096)
  var asciiRatio = sample ? printable / sample : 0

  // 3) 尝试 UTF-8（如果看起来合法）
  if (asciiRatio > 0.5) {
    try {
      var utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      var replacementCount = (utf8.match(/\uFFFD/g) || []).length
      if (replacementCount < utf8.length * 0.01) {
        return utf8
      }
    } catch (e) {}
  }

  // 4) 尝试 GBK（中文 MOBI 常见）
  try {
    if (typeof TextDecoder !== 'undefined') {
      var gbk = new TextDecoder('gbk', { fatal: false }).decode(bytes)
      if (gbk && gbk.length > 0) {
        var replacementGbk = (gbk.match(/\uFFFD/g) || []).length
        var chineseCount = (gbk.match(/[\u4e00-\u9fff]/g) || []).length
        if (chineseCount > 5 && replacementGbk < gbk.length * 0.05) {
          return gbk
        }
      }
    }
  } catch (e) {}

  // 5) 尝试 GB18030（GBK 超集）
  try {
    if (typeof TextDecoder !== 'undefined') {
      var gb18030 = new TextDecoder('gb18030', { fatal: false }).decode(bytes)
      if (gb18030 && gb18030.length > 0) {
        return gb18030
      }
    }
  } catch (e) {}

  // 6) 尝试 Windows-1252（英文 MOBI 默认）
  try {
    var cp1252 = new TextDecoder('windows-1252').decode(bytes)
    if (cp1252 && cp1252.length > 0) return cp1252
  } catch (e) {}

  // 7) 最后回退 UTF-8 非严格模式
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch (e) {
    return ''
  }
}

async function readFileWithProgress(file, onProgress) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader()
    var total = file.size
    var startTime = Date.now()

    var fallbackTimer = setInterval(function() {
      var elapsed = Date.now() - startTime
      if (elapsed > 100 && total > 0) {
        var pct = Math.min(0.29, (elapsed / 5000) * 0.3)
        if (onProgress) onProgress('正在读取文件 (' + (elapsed / 1000).toFixed(1) + 's)...', pct)
      }
    }, 150)

    reader.onprogress = function(e) {
      if (e.lengthComputable && total > 0) {
        clearInterval(fallbackTimer)
        var pct = Math.min(0.3, e.loaded / total * 0.3)
        if (onProgress) onProgress('正在读取文件... ' + (e.loaded / 1024 / 1024).toFixed(1) + 'MB/' + (total / 1024 / 1024).toFixed(1) + 'MB', pct)
      }
    }

    reader.onload = function() {
      clearInterval(fallbackTimer)
      if (onProgress) onProgress('文件读取完成', 0.3)
      resolve(reader.result)
    }
    reader.onerror = function() {
      clearInterval(fallbackTimer)
      reject(new Error('文件读取失败'))
    }

    if (file.type.indexOf('text') !== -1 || /\.(txt|fb2)$/i.test(file.name)) {
      reader.readAsText(file)
    } else {
      reader.readAsArrayBuffer(file)
    }
  })
}

function splitIntoSentences(text) {
  var raw = text.match(/[^。！？\n.!?]+[。！？\n.!?]?/g) || [text]
  var result = []
  var buf = ''
  for (var i = 0; i < raw.length; i++) {
    var s = raw[i]
    var t = s.trim()
    if (!t) continue
    if (t.length < 5 && !/[。！？.!?]/.test(t) && result.length > 0) {
      result[result.length - 1] += t
    } else {
      if (buf) {
        result.push(buf)
        buf = ''
      }
      result.push(t)
    }
  }
  if (buf) result.push(buf)
  return result.filter(function(s) { return s.length > 0 })
}

if (typeof window !== 'undefined') window.splitIntoSentences = splitIntoSentences

var PARSERS = {
  parse: async function(file, onProgress) {
    var ext = file.name.split('.').pop().toLowerCase()
    var map = {
      txt: this.parseTXT,
      pdf: this.parsePDF,
      epub: this.parseEPUB,
      docx: this.parseDOCX,
      mobi: this.parseMOBI,
      azw3: this.parseMOBI,
      prc: this.parseMOBI,
      fb2: this.parseFB2,
    }
    var fn = map[ext]
    if (!fn) throw new Error('不支持 ' + ext + ' 格式（支持 TXT/PDF/EPUB/DOCX/MOBI/AZW3/FB2）')
    try {
      return await fn.call(this, file, onProgress)
    } catch (e) {
      throw new Error('文件过大或格式异常: ' + (e.message || e))
    }
  },

  parseFB2: async function(file, onProgress) {
    var text = await readFileWithProgress(file, onProgress)
    if (onProgress) onProgress('正在解析 FB2...', 0.4)
    await new Promise(function(r) { setTimeout(r, 0) })
    var dom = new DOMParser()
    var doc = dom.parseFromString(text, 'text/xml')
    var body = doc.querySelector('body')
    if (!body) throw new Error('FB2 格式错误：找不到 body')
    var sections = body.querySelectorAll('section')
    if (sections.length) {
      var chapters = []
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i]
        var titleEl = sec.querySelector('title')
        var title = titleEl ? titleEl.textContent.trim() : ('第 ' + (chapters.length + 1) + ' 章')
        var content = sec.textContent ? sec.textContent.trim() : ''
        if (content) chapters.push({ title: title, content: content })
        if (i % 50 === 0 && onProgress) onProgress('正在解析章节...', 0.4 + (i / sections.length) * 0.4)
        if (i % 100 === 0) await new Promise(function(r) { setTimeout(r, 0) })
      }
      return chapters.length ? chapters : [{
        title: file.name.replace(/\.[^.]+$/, ''),
        content: body.textContent ? body.textContent.trim() : '',
      }]
    }
    return splitChapters(body.textContent ? body.textContent.trim() : '')
  },

  parseTXT: async function(file, onProgress) {
    var text = await readFileWithProgress(file, onProgress)
    if (onProgress) onProgress('正在分割章节...', 0.9)
    await new Promise(function(r) { setTimeout(r, 0) })
    return splitChapters(text)
  },

  parsePDF: async function(file, onProgress) {
    var data = await readFileWithProgress(file, onProgress)
    if (onProgress) onProgress('正在加载 PDF...', 0.35)
    var pdfjsLib = window.pdfjsLib
    if (!pdfjsLib) throw new Error('PDF 解析库未加载')
    var doc = await pdfjsLib.getDocument({ data: data }).promise
    var text = ''
    var total = doc.numPages
    for (var i = 1; i <= total; i++) {
      var page = await doc.getPage(i)
      var content = await page.getTextContent()
      text += content.items.map(function(item) { return item.str }).join(' ') + '\n\n'
      if (onProgress) onProgress('解析 PDF 第 ' + i + '/' + total + ' 页...', 0.35 + (i / total) * 0.5)
    }
    if (onProgress) onProgress('正在分割章节...', 0.95)
    return splitChapters(text.trim())
  },

  parseEPUB: async function(file, onProgress) {
    var data = await readFileWithProgress(file, onProgress)
    if (onProgress) onProgress('正在解压 EPUB...', 0.35)
    var zip = new JSZip()
    await zip.loadAsync(data)

    var containerFile = zip.file('META-INF/container.xml')
    if (!containerFile) throw new Error('Invalid EPUB: no container.xml')
    var containerXml = await containerFile.async('string')
    if (!containerXml) throw new Error('Invalid EPUB: empty container.xml')

    var opfPathMatch = containerXml.match(/full-path="([^"]+)"/)
    if (!opfPathMatch) throw new Error('Invalid EPUB: no OPF path')
    var opfPath = opfPathMatch[1]
    var opfFile = zip.file(opfPath)
    if (!opfFile) throw new Error('Invalid EPUB: no OPF file')
    var opfXml = await opfFile.async('string')
    if (!opfXml) throw new Error('Invalid EPUB: empty OPF')

    var opf = new DOMParser().parseFromString(opfXml, 'text/xml')

    var manifest = {}
    opf.querySelectorAll('manifest > item').forEach(function(item) {
      var id = item.getAttribute('id')
      var href = item.getAttribute('href')
      if (id && href) manifest[id] = { href: href }
    })

    var spine = []
    opf.querySelectorAll('spine > itemref').forEach(function(ref) {
      var idref = ref.getAttribute('idref')
      if (idref) spine.push(idref)
    })

    var opfDir = opfPath.indexOf('/') !== -1 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''

    var tasks = spine.map(function(refId) {
      var item = manifest[refId]
      if (!item) return null
      var href = opfDir + item.href
      var entry = zip.file(href)
      if (!entry) return null
      return { refId: refId, href: href, entry: entry }
    }).filter(function(x) { return x })

    if (!tasks.length) throw new Error('未找到章节内容')

    var total = tasks.length
    var chapters = []
    var batchSize = Math.max(5, Math.min(20, Math.ceil(total / 20)))
    for (var i = 0; i < total; i += batchSize) {
      var batch = tasks.slice(i, i + batchSize)
      var results = await Promise.all(batch.map(function(obj) {
        return obj.entry.async('string').then(function(raw) {
          var titleMatch = raw.match(/<title>([^<]*)<\/title>/i)
          var title = titleMatch ? titleMatch[1].trim() : ''
          if (!title) {
            var hMatch = raw.match(/<h[1-3][^>]*>([^<]*)<\/h[1-3]>/i)
            title = hMatch ? hMatch[1].trim() : ''
          }
          var text = raw
            .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>|<[^>]+>/gi, '')
            .replace(/&nbsp;|&[a-z]+;|\s+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
          return text.length > 0 ? { title: title || text.slice(0, 60), content: text } : null
        }).catch(function() { return null })
      }))
      for (var r = 0; r < results.length; r++) {
        if (results[r]) chapters.push(results[r])
      }
      var done = Math.min(i + batchSize, total)
      if (onProgress) onProgress('解析中 ' + done + '/' + total + ' 章', 0.35 + (done / total) * 0.5)
      await new Promise(function(r) { setTimeout(r, 0) })
    }

    if (chapters.length === 0) throw new Error('未找到章节内容')
    return chapters
  },

  parseDOCX: async function(file, onProgress) {
    var data = await readFileWithProgress(file, onProgress)
    var mammoth = window.mammoth
    if (!mammoth) throw new Error('DOCX 解析库未加载')
    if (onProgress) onProgress('正在提取文本...', 0.6)
    await new Promise(function(r) { setTimeout(r, 0) })
    var result = await mammoth.extractRawText({ arrayBuffer: data })
    if (onProgress) onProgress('正在分割章节...', 0.9)
    return splitChapters(result.value)
  },

  parseMOBI: async function(file, onProgress) {
    var buffer = await readFileWithProgress(file, onProgress)
    if (onProgress) onProgress('正在解析 MOBI...', 0.35)
    await new Promise(function(r) { setTimeout(r, 0) })

    var bytes = new Uint8Array(buffer)
    var view = new DataView(buffer)

    if (bytes.length < 16) throw new Error('MOBI 文件过小')

    // === 1. 自动定位 MOBI 头 ===
    var mobiMagicOffset = -1
    var searchLimit = Math.min(bytes.length, 4096)
    for (var s = 0; s < searchLimit - 4; s++) {
      if (bytes[s] === 0x4D && bytes[s+1] === 0x4F && bytes[s+2] === 0x42 && bytes[s+3] === 0x49) {
        if (s + 8 <= bytes.length) {
          var hlen = (bytes[s+4] << 24) | (bytes[s+5] << 16) | (bytes[s+6] << 8) | bytes[s+7]
          if (hlen > 0x80 && hlen < 0x4000) {
            mobiMagicOffset = s
            break
          }
        }
      }
    }

    if (mobiMagicOffset < 0) {
      // 最后兜底：扫描整个文件找 HTML 内容
      if (onProgress) onProgress('尝试扫描整个文件...', 0.4)
      var htmlText = scanForHtmlContent(bytes)
      if (htmlText && htmlText.length > 100) {
        if (onProgress) onProgress('正在分割章节...', 0.9)
        return splitChapters(htmlText)
      }
      throw new Error('不是有效的 MOBI 文件：找不到 MOBI 头标识')
    }

    console.log('[MOBI] MOBI 头偏移:', mobiMagicOffset)

    // === 2. 检查文件开头是否是标准 PalmDOC 头 ===
    var recordCount = 0
    var recordTableStart = 0
    var palmdocFound = false
    var palmdocOffset = 0

    if (bytes.length >= 16) {
      var firstCompression = view.getUint16(0, false)
      var firstRecordCount = view.getUint16(8, false)
      var firstEncryption = view.getUint16(12, false)
      if (firstCompression <= 2 && firstRecordCount > 0 && firstRecordCount < 100000 && firstEncryption <= 1) {
        recordCount = firstRecordCount
        palmdocOffset = 0
        recordTableStart = 16 + 2
        palmdocFound = true
        console.log('[MOBI] 标准格式: 记录数:', recordCount)
      }
    }

    // === 3. 如果不是标准格式，尝试 AZW3/KF8 ===
    if (!palmdocFound) {
      // 计算 PalmDOC 头位置（在 MOBI 头前 16 字节或文件开头）
      palmdocOffset = Math.max(0, mobiMagicOffset - 16)

      // 从 MOBI 头读取头长度
      var mobiHeaderLength = (bytes[mobiMagicOffset+4] << 24) | (bytes[mobiMagicOffset+5] << 16) | (bytes[mobiMagicOffset+6] << 8) | bytes[mobiMagicOffset+7]
      // 记录表起始 = MOBI 头结束位置
      recordTableStart = mobiMagicOffset + mobiHeaderLength

      // 检查并跳过 EXTH 头
      var exthFlags = (bytes[mobiMagicOffset+92] << 24) | (bytes[mobiMagicOffset+93] << 16) | (bytes[mobiMagicOffset+94] << 8) | bytes[mobiMagicOffset+95]
      if ((exthFlags & 0x40) !== 0) {
        var exthLength = (bytes[mobiMagicOffset+96] << 24) | (bytes[mobiMagicOffset+97] << 16) | (bytes[mobiMagicOffset+98] << 8) | bytes[mobiMagicOffset+99]
        recordTableStart = mobiMagicOffset + 16 + exthLength
        console.log('[MOBI] EXTH 长度:', exthLength)
      }

      // 尝试从 PalmDOC 头读取记录数
      if (palmdocOffset + 10 <= bytes.length) {
        recordCount = view.getUint16(palmdocOffset + 8, false)
        console.log('[MOBI] AZW3 格式: PalmDOC 偏移', palmdocOffset, '记录数:', recordCount)
      }
    }

    // === 4. 读取记录表 ===
    var records = []
    if (recordCount > 0 && recordCount <= 100000 && recordTableStart + 8 <= bytes.length) {
      for (var i = 0; i < recordCount; i++) {
        var off = recordTableStart + i * 8
        if (off + 8 > bytes.length) break
        var offset = view.getUint32(off, false)
        var nextOff = (i + 1 < recordCount && off + 16 <= bytes.length) ? view.getUint32(off + 8, false) : bytes.length
        if (offset === 0xFFFFFFFF || offset > bytes.length) continue
        records.push({ offset: offset, nextOffset: nextOff })
      }
      console.log('[MOBI] 解析出', records.length, '条记录')
    }

    // === 5. 读取 MOBI 头获取编码 ===
    var textEncoding = 1252
    var compression = 2
    var encryption = 0

    try {
      if (palmdocOffset + 16 <= bytes.length) {
        compression = view.getUint16(palmdocOffset, false)
        encryption = view.getUint16(palmdocOffset + 12, false)
      }
      if (encryption !== 0 && encryption !== 1) encryption = 0

      if (mobiMagicOffset + 16 <= bytes.length) {
        textEncoding = view.getUint32(mobiMagicOffset + 12, false)
        console.log('[MOBI] 压缩:', compression, '编码:', textEncoding)
      }
    } catch (e) { console.warn('[MOBI] 读取编码失败:', e) }

    // === 6. 如果没读到有效记录，尝试扫描整个文件 ===
    if (records.length < 2) {
      console.log('[MOBI] 记录表无效，尝试扫描整个文件找 HTML')
      if (onProgress) onProgress('扫描文件中...', 0.4)
      var htmlText = scanForHtmlContent(bytes)
      if (htmlText && htmlText.length > 100) {
        if (onProgress) onProgress('正在分割章节...', 0.9)
        return splitChapters(htmlText)
      }
      throw new Error('无法解析 MOBI 文件结构')
    }

    var rec0 = records[0]
    var textRecords = records.slice(1)
    var totalRecords = textRecords.length

    if (onProgress) onProgress('正在解压 MOBI (' + totalRecords + ' 条记录)...', 0.4)

    // === 5. MOBI 编码到标准编码的映射 ===
    var encodingMap = {
      1252: 'windows-1252',
      65001: 'utf-8',
      936: 'gbk',
      54936: 'gb18030',
      950: 'big5',
      932: 'shift_jis',
      949: 'euc-kr',
      10000: 'macroman',
      1200: 'utf-16le',
      1201: 'utf-16be',
      // 一些非标准编码值
      0x0263: 'gb18030',  // 611 (部分 Z-Library 转换)
      0x0258: 'gb18030',  // 600
      0x0262: 'gb18030',  // 610
    }
    var encoding = encodingMap[textEncoding] || 'utf-8'
    console.log('[MOBI] 使用编码:', encoding)

    var allText = ''
    var MAX_TOTAL = 12000000

    var stripHTML = function(s) {
      if (!s) return ''
      return s
        .replace(/<\?xml[^>]*>/gi, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|h[1-6]|li|tr|td|blockquote|pre)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, function(m, c) { return String.fromCharCode(parseInt(c, 10)) })
        .replace(/&#x([0-9a-fA-F]+);/g, function(m, c) { return String.fromCharCode(parseInt(c, 16)) })
    }

    // 解码函数 - 使用 MOBI 头指定的编码
    function decodeWithEncoding(data) {
      if (!data || !data.length) return ''
      try {
        // 优先用 MOBI 头指定的编码
        if (encoding !== 'utf-8') {
          return new TextDecoder(encoding, { fatal: false }).decode(data)
        }
        // UTF-8 模式下用智能解码
        return decodeBytes(data)
      } catch (e) {
        return decodeBytes(data)
      }
    }

    for (var i = 0; i < totalRecords; i++) {
      if (allText.length >= MAX_TOTAL) break

      var rec = textRecords[i]
      var start = rec.offset
      var end = rec.nextOffset
      if (start >= bytes.length) continue
      if (end <= start || end > bytes.length) end = Math.min(start + 4096, bytes.length)

      var recData = bytes.slice(start, end)

      try {
        var chunk
        if (compression === 1 || compression === 2) {
          // PalmDoc 压缩
          var decompressed = decompressPalmDoc(recData)
          chunk = decodeWithEncoding(decompressed)
          chunk = stripHTML(chunk)
        } else {
          // 未压缩
          chunk = decodeWithEncoding(recData)
          chunk = stripHTML(chunk)
        }

        if (!chunk || chunk.length < 5) continue

        var printable = (chunk.match(/[\u0020-\u007E\u4e00-\u9fff\u00C0-\u024F\u3040-\u30FF\u0400-\u04FF]/g) || []).length
        if (chunk.length > 50 && printable / chunk.length < 0.1) continue

        if (allText.length + chunk.length > MAX_TOTAL) {
          allText += chunk.slice(0, MAX_TOTAL - allText.length)
          break
        }
        allText += chunk
      } catch (e) {
        continue
      }

      if (i % 200 === 0 || i === totalRecords - 1) {
        if (onProgress) onProgress('解析 MOBI 中 ' + (i + 1) + '/' + totalRecords + '...', 0.4 + (i + 1) / totalRecords * 0.45)
        await new Promise(function(r) { setTimeout(r, 0) })
      }
    }

    // 备用方案：用未压缩数据尝试
    if (!allText || allText.length < 50) {
      if (onProgress) onProgress('尝试备用方式...', 0.7)
      allText = ''
      for (var i = 0; i < totalRecords; i++) {
        var rec = textRecords[i]
        var start = rec.offset
        var end = rec.nextOffset
        if (start >= bytes.length) continue
        if (end <= start || end > bytes.length) end = Math.min(start + 4096, bytes.length)
        try {
          var chunk = decodeWithEncoding(bytes.slice(start, end))
          chunk = stripHTML(chunk)
          if (chunk.length > 5) allText += chunk
        } catch (e) { continue }
        if (allText.length >= MAX_TOTAL) break
        if (i % 200 === 0 && onProgress) onProgress('备用解析中...', 0.7 + (i / totalRecords) * 0.15)
        if (i % 200 === 0) await new Promise(function(r) { setTimeout(r, 0) })
      }
    }

    // 最后备用：扫整个文件找 HTML 文本
    if (!allText || allText.length < 50) {
      if (onProgress) onProgress('最后尝试:扫描全文件...', 0.7)
      try {
        allText = decodeWithEncoding(bytes)
        allText = stripHTML(allText)
      } catch (e) {}
    }

    if (!allText || allText.length < 50) throw new Error('未能从 MOBI 提取到文本')

    allText = allText.replace(/\r/g, '').replace(/\x00/g, '')
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

    if (onProgress) onProgress('正在分割章节...', 0.9)
    await new Promise(function(r) { setTimeout(r, 0) })
    return splitChapters(allText)
  },
}

// 在 MOBI 结构无法正常解析时（如某些转换过的 AZW3 文件），
// 扫描整个文件寻找 HTML 内容并尝试用 GB18030 解码
function scanForHtmlContent(bytes) {
  // 查找 "<html" "<HTML" "<body" "<p " 等标记
  var markers = [
    [0x3C, 0x68, 0x74, 0x6D, 0x6C],      // <html
    [0x3C, 0x48, 0x54, 0x4D, 0x4C],      // <HTML
    [0x3C, 0x62, 0x6F, 0x64, 0x79],      // <body
    [0x3C, 0x42, 0x4F, 0x44, 0x59],      // <BODY
  ]

  var foundOffsets = []
  for (var m = 0; m < markers.length; m++) {
    var marker = markers[m]
    for (var i = 0; i < bytes.length - marker.length; i++) {
      var match = true
      for (var k = 0; k < marker.length; k++) {
        if (bytes[i + k] !== marker[k]) { match = false; break }
      }
      if (match) {
        foundOffsets.push(i)
        if (foundOffsets.length > 20) break
      }
    }
    if (foundOffsets.length > 20) break
  }

  if (foundOffsets.length === 0) return ''

  // 找到第一个 HTML 标记的位置，从那里开始解码
  var startOff = foundOffsets[0]
  // 往前看一段寻找章节标记
  var content = decodeWithMultiEncoding(bytes, startOff)
  console.log('[MOBI] 扫描模式找到 HTML 起始:', startOff, '内容长度:', content.length)
  return content
}

function decodeWithMultiEncoding(bytes, startOff) {
  // 尝试多种编码解码。优先 UTF-8（现代 MOBI/AZW3 转换工具都输出 UTF-8）
  var encodings = ['utf-8', 'gb18030', 'gbk', 'big5', 'windows-1252']
  // 限制最大长度以避免卡死
  var maxLen = Math.min(bytes.length - startOff, 8000000)
  var sub = bytes.subarray(startOff, startOff + maxLen)

  // 优先尝试 UTF-8（现代 MOBI/AZW3 转换工具都输出 UTF-8）
  // 对烂文件，会用 \uFFFD 替换无效字节，再由 htmlToPlainText 清理
  for (var e = 0; e < encodings.length; e++) {
    try {
      var text = new TextDecoder(encodings[e], { fatal: false }).decode(sub)
      // 检查解码后是否包含中文或可读字符
      if (text && text.length > 100) {
        var chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length
        var readable = (text.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
        if (readable > text.length * 0.3 || chineseCount > 100) {
          console.log('[MOBI] 解码成功使用编码:', encodings[e], '中文字符:', chineseCount)
          return text
        }
      }
    } catch (err) { /* 尝试下一种 */ }
  }
  // 兜底用 UTF-8
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(sub)
  } catch (e) {
    return ''
  }
}

// 把 HTML 转成纯文本（用于扫描模式直接获得的 HTML 字符串）
function htmlToPlainText(html) {
  if (!html) return ''
  var text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|br|hr|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(m, n) { return String.fromCharCode(parseInt(n, 10)) })
    .replace(/&#x([0-9a-fA-F]+);/g, function(m, n) { return String.fromCharCode(parseInt(n, 16)) })
  text = text.replace(/\r/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // 清理因二进制残留造成的乱码
  // 策略：移除连续的非可打印中英字符（保留中文、英文、数字、常见标点）
  text = text.split('\n').map(function(line) {
    // 移除控制字符
    line = line.replace(/[\uFFFD\u0000-\u001F\u007F]/g, '')
    // 移除孤立的乱码（CJK 私有区、不可打印区、Latin-1 补充中的怪异字符）
    line = line.replace(/[\uE000-\uF8FF]/g, '')
    // 移除不含中文/英文/标点的乱码字符块
    // 一个字符如果前后都不是中文/英文/数字/常见标点，则视为噪声
    var cleaned = ''
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i)
      var code = line.charCodeAt(i)
      // 保留：中文(\u4e00-\u9fa5, \u3000-\u303f, \uff00-\uffef)、英文、数字、空白、常见标点
      var isKeep = (
        (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK
        (code >= 0x3000 && code <= 0x303F) ||   // CJK 标点
        (code >= 0xFF00 && code <= 0xFFEF) ||   // 全角字符
        (code >= 0x20 && code <= 0x7E) ||        // ASCII 可打印
        code === 0x0A || code === 0x0D            // 换行回车
      )
      if (isKeep) cleaned += c
    }
    return cleaned
  }).filter(function(line) {
    // 只保留至少含一个中英文字符的行
    return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z]/.test(line)
  }).join('\n')
  // 再次规范化空白
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return text
}

function splitChapters(text) {
  // 如果是 HTML 字符串，先转纯文本
  if (/<[a-zA-Z!\/][^>]*>/.test(text)) {
    text = htmlToPlainText(text)
  }
  // 通用章节标记：中文第X章/回/节、Part/Book/Chapter 数字、或数字+点号开头
  var regex = /第[\u4e00-\u9fa5\d一二三四五六七八九十百千]+[章回节卷集]|(?:^|\n)\s*(?:第[\u4e00-\u9fa5\d一二三四五六七八九十百千]+[章回节卷集]|Chapter\s+\d+|CHAPTER\s+\d+|Part\s+\d+|Book\s+\d+|第\s*\d+\s*[章回节卷集])\s*(?:[\s:：-]+[^\n]{0,40})?/gim
  var matches = []
  var match
  while ((match = regex.exec(text)) !== null) {
    matches.push(match)
  }

  if (matches.length > 1) {
    var chapters = []
    for (var i = 0; i < matches.length; i++) {
      var start = matches[i].index
      var end = i + 1 < matches.length ? matches[i + 1].index : text.length
      var title = matches[i][0].trim()
      // 取标题后的第一行内容作为补充标题
      var rest = text.slice(start + title.length, end).trim().split(/\n/)[0] || ''
      rest = rest.replace(/^[\s:：-]+/, '').slice(0, 40).trim()
      chapters.push({
        title: rest ? (title + ' ' + rest) : title,
        content: text.slice(start, end).trim(),
      })
    }
    return chapters
  }

  // 没有章节标记时，尝试按空行分段，再每 3000 字分一个虚拟章节
  var paragraphs = text.split(/\n\s*\n/).filter(function(p) { return p.trim() })
  var chunks = []
  var current = ''
  for (var i = 0; i < paragraphs.length; i++) {
    var p = paragraphs[i]
    if ((current + p).length > 3000 && current) {
      chunks.push(current.trim())
      current = p
    } else {
      current += '\n\n' + p
    }
  }
  if (current) chunks.push(current.trim())

  return chunks.map(function(c, i) {
    var firstLine = c.split('\n')[0] ? c.split('\n')[0].trim().slice(0, 60) : ''
    return { title: firstLine || ('第 ' + (i + 1) + ' 部分'), content: c }
  })
}
