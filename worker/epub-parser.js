// worker/epub-parser.js
self.onmessage = async function(e) {
  const { data, type } = e.data
  
  if (type === 'parse') {
    try {
      const JSZip = await importScripts ? 
        importScripts('https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js') :
        null
      
      if (!self.JSZip) {
        await self.importScripts('https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js')
      }
      
      const zip = new self.JSZip()
      await zip.loadAsync(data)
      
      const containerXml = await zip.file('META-INF/container.xml')?.async('string')
      if (!containerXml) throw new Error('Invalid EPUB: no container.xml')
      
      const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1]
      if (!opfPath) throw new Error('Invalid EPUB: no OPF path')
      
      const opfXml = await zip.file(opfPath)?.async('string')
      if (!opfXml) throw new Error('Invalid EPUB: no OPF file')
      
      const opf = new self.DOMParser().parseFromString(opfXml, 'text/xml')
      
      const manifest = {}
      opf.querySelectorAll('manifest > item').forEach(item => {
        const id = item.getAttribute('id')
        const href = item.getAttribute('href')
        if (id && href) manifest[id] = { href }
      })
      
      const spine = []
      opf.querySelectorAll('spine > itemref').forEach(ref => {
        const idref = ref.getAttribute('idref')
        if (idref) spine.push(idref)
      })
      
      const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
      
      const fileTasks = spine.map(refId => {
        const item = manifest[refId]
        if (!item) return null
        const href = opfDir + item.href
        const entry = zip.file(href)
        if (!entry) return null
        return { refId, href, entry }
      }).filter(Boolean)
      
      if (!fileTasks.length) throw new Error('未找到章节内容')
      
      const chapters = []
      for (const { href, entry } of fileTasks) {
        const raw = await entry.async('string')
        const title = raw.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()
          || raw.match(/<h[1-3][^>]*>([^<]*)<\/h[1-3]>/i)?.[1]?.trim()
          || ''
        const text = raw
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&[a-z]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        if (text.length > 0) {
          chapters.push({ title: title || text.slice(0, 60), content: text })
        }
      }
      
      self.postMessage({ type: 'done', chapters })
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message })
    }
  }
}
