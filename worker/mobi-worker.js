/**
 * Cloudflare Worker - MOBI 文本提取
 * 部署：cf workers deploy mobi-worker.js --name mobi-parser
 */

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() })
    }

    if (request.method !== 'POST') {
      return new Response('Send POST with MOBI file', { status: 400 })
    }

    try {
      const formData = await request.formData()
      const file = formData.get('file')
      if (!file) throw new Error('No file provided')

      const buffer = await file.arrayBuffer()
      const text = extractMobiText(buffer)

      return new Response(JSON.stringify({ text }), {
        headers: { ...cors(), 'Content-Type': 'application/json' },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...cors(), 'Content-Type': 'application/json' },
      })
    }
  },
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  }
}

function extractMobiText(buffer) {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // --- PDB Header ---
  if (bytes.length < 78) throw new Error('File too small for PDB')

  const name = readStr(bytes, 0, 32)
  const numRecords = view.getUint16(76, false)

  // --- PDB Record Info ---
  const records = []
  for (let i = 0; i < numRecords; i++) {
    const off = 78 + i * 8
    if (off + 8 > bytes.length) break
    const recordOffset = view.getUint32(off, false)
    const recordAttr = view.getUint32(off + 4, false)
    const uniqueID = view.getUint32(off + 6, false)
    records.push({ offset: recordOffset, attr: recordAttr, id: uniqueID })
  }

  // Find MOBI header (record 0)
  if (records.length < 2) throw new Error('No records found')

  const mobiOff = records[0].offset
  if (mobiOff + 16 > bytes.length) throw new Error('MOBI header too short')

  // MOBI header at record 0
  const mobiMagic = view.getUint32(mobiOff, false)
  if (mobiMagic !== 0x4D4F4249 && mobiMagic !== 0x424F4F4B) {
    throw new Error('Not a MOBI file (magic: ' + mobiMagic.toString(16) + ')')
  }

  const headerLen = view.getUint32(mobiOff + 20, false)
  const textEncoding = view.getUint32(mobiOff + 84, false)

  const firstRecordIdx = records.length > 1 ? 1 : 0
  const textStart = records[firstRecordIdx].offset
  const compression = view.getUint16(mobiOff + 0, false)
  const textLength = view.getUint32(mobiOff + 8, false)
  const fullTextLen = textLength || (bytes.length - textStart)

  // Extract text records
  let rawText = ''
  for (let i = firstRecordIdx; i < records.length; i++) {
    const start = records[i].offset
    const end = i + 1 < records.length ? records[i + 1].offset : bytes.length
    const recordBytes = bytes.slice(start, end)
    rawText += decompressRecord(recordBytes, compression)
  }

  // Clean up
  rawText = rawText
    .replace(/\r/g, '')
    .replace(/\x00/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!rawText.length) throw new Error('No text content found')

  return rawText
}

function decompressPalmDoc(data) {
  let result = ''
  let i = 0
  while (i < data.length) {
    const b = data[i]
    if (b === 0) {
      result += '\n'
      i++
    } else if (b >= 1 && b <= 8) {
      result += String.fromCharCode(b)
      i++
    } else if (b >= 9 && b <= 127) {
      result += String.fromCharCode(b)
      i++
    } else if (b >= 128 && b <= 191) {
      const next = i + 1 < data.length ? data[i + 1] : 0x20
      const spaceCount = ((b & 0x3F) << 8) | (next & 0xFF)
      result += ' '.repeat(Math.max(1, spaceCount))
      i += 2
    } else if (b >= 192 && b <= 207) {
      const n = b - 192
      const offset = i > 0 ? data[i - 1] : 0
      if (i >= 3) {
        const pos = data[i - 2] + ((data[i - 3] & 3) << 8)
        const len = n + 3
        const start = Math.max(0, pos)
        const copy = result.slice(start, start + len)
        result += copy
      }
      i++
    } else if (b >= 208 && b <= 255) {
      if (i + 2 < data.length) {
        const n = (b - 208) * 256 + data[i + 1]
        const dist = data[i + 2]
        const len = n + 3
        const start = Math.max(0, result.length - dist)
        const copy = result.slice(start, start + len)
        result += copy
        i += 3
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return result
}

function decompressRecord(data, compression) {
  if (compression === 1) {
    return decompressPalmDoc(data)
  }
  if (compression === 2) {
    try {
      return decompressHuffman(data)
    } catch {
      return decompressPalmDoc(data)
    }
  }
  return new TextDecoder('utf-8').decode(data)
}

function decompressHuffman(data) {
  // Simple Huffman: first 2 bytes are table offset, rest is compressed
  const tableOffset = (data[0] << 8) | data[1]
  const table = data.slice(tableOffset)
  const codeData = data.slice(2, tableOffset)

  const nodes = []
  for (let i = 0; i + 4 <= table.length; i += 4) {
    const left = (table[i] << 8) | table[i + 1]
    const right = (table[i + 2] << 8) | table[i + 3]
    nodes.push({ left, right })
  }

  let result = ''
  let nodeIdx = 0
  for (let bitPos = 0; bitPos < codeData.length * 8; bitPos++) {
    const byteIdx = Math.floor(bitPos / 8)
    const bit = (codeData[byteIdx] >> (7 - (bitPos % 8))) & 1
    const node = nodes[nodeIdx]

    if (!node) {
      result += String.fromCharCode(nodeIdx)
      nodeIdx = 0
      continue
    }

    if (bit === 0) {
      if (node.left < 0x100) {
        result += String.fromCharCode(node.left)
        nodeIdx = 0
      } else {
        nodeIdx = node.left - 0x100
      }
    } else {
      if (node.right < 0x100) {
        result += String.fromCharCode(node.right)
        nodeIdx = 0
      } else {
        nodeIdx = node.right - 0x100
      }
    }
  }

  return result
}

function readStr(bytes, offset, maxLen) {
  let s = ''
  for (let i = offset; i < offset + maxLen && i < bytes.length; i++) {
    if (bytes[i] === 0) break
    s += String.fromCharCode(bytes[i])
  }
  return s
}
