function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attr(tag, name) {
  const match = new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'i').exec(tag)
  return match ? decodeEntities(match[1]) : ''
}

function splitTag(fragment) {
  let quote = ''
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return { tag: fragment.slice(0, i), rest: fragment.slice(i + 1) }
  }
  return null
}

function redgifsSlug(html) {
  const text = html.replace(/&amp;/g, '&')
  const plain = text.match(/https?:\/\/(?:[\w.-]+\.)?redgifs\.com\/(?:watch|ifr)\/([a-z0-9-]+)/i)
  if (plain) return plain[1]
  const encoded = text.match(/redgifs\.com(?:%2F|\/)(?:watch|ifr)(?:%2F|\/)([a-z0-9-]+)/i)
  if (encoded) return encoded[1]
  const poster = text.match(/media\.redgifs\.com\/([a-z0-9-]+)-poster/i)
  if (poster) return poster[1]
  return ''
}

function usableCover(url) {
  if (/[?&]blur=/i.test(url)) return false
  if (/snoovatar|profileicon|award_images|\/styles\/|\/emoji\//i.test(url)) return false
  return true
}

function firstClearUrl(text, source) {
  const re = new RegExp(source, 'gi')
  let match
  while ((match = re.exec(text))) {
    if (usableCover(match[0])) return match[0]
  }
  return ''
}

function coverUrl(html) {
  const text = decodeEntities(html)
  const patterns = [
    'https:\\/\\/media\\.redgifs\\.com\\/[^\\s"\'<>]+-poster\\.[a-z0-9]+',
    'https:\\/\\/thumbs\\d*\\.redgifs\\.com\\/[^\\s"\'<>]+',
    'https:\\/\\/i\\.redd\\.it\\/[a-z0-9]+\\.(?:jpe?g|png|gif|webp)',
    'https:\\/\\/preview\\.redd\\.it\\/[^\\s"\'<>]+',
    'https:\\/\\/external-preview\\.redd\\.it\\/[^\\s"\'<>]+'
  ]
  for (let i = 0; i < patterns.length; i++) {
    const found = firstClearUrl(text, patterns[i])
    if (found) return found
  }
  return ''
}

function splitHttpUrl(raw) {
  const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(raw)
  if (!match) return null
  return { hostname: match[1].toLowerCase(), pathname: match[2] || '/' }
}

function imageFromUrl(raw) {
  const url = splitHttpUrl(raw)
  if (!url) return null
  if (/profileicon|snoovatar|\/styles\//i.test(url.pathname)) return null
  const base = decodeURIComponent(url.pathname.split('/').pop() || '')
  let filename = base
  if (url.hostname === 'preview.redd.it') {
    const hyphen = base.lastIndexOf('-')
    if (hyphen >= 0) filename = base.slice(hyphen + 1)
  } else if (url.hostname !== 'i.redd.it') {
    return null
  }
  const match = filename.match(/^([a-z0-9]+)\.(jpe?g|png|gif|webp)$/i)
  if (!match) return null
  const id = match[1].toLowerCase()
  const ext = match[2].toLowerCase()
  return { id, ext, url: 'https://i.redd.it/' + id + '.' + ext }
}

function collectImages(html) {
  const found = []
  const seen = new Set()
  const re = /https:\/\/(?:preview|i)\.redd\.it\/[^\s"'<>]+/gi
  let match
  while ((match = re.exec(html))) {
    const image = imageFromUrl(match[0])
    if (!image || seen.has(image.id)) continue
    seen.add(image.id)
    found.push(image)
  }
  return found
}

function imageFiles(html) {
  const found = []
  const seen = new Set()
  const re = /https:\/\/i\.redd\.it\/([a-z0-9]+)\.(jpe?g|png|gif|webp)/gi
  let match
  while ((match = re.exec(html))) {
    const id = match[1].toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    const ext = match[2].toLowerCase()
    found.push({ id, ext, url: 'https://i.redd.it/' + id + '.' + ext })
  }
  return found
}

function galleryImages(html) {
  const text = decodeEntities(html)
  const carousel = text.match(/<gallery-carousel\b[\s\S]*?<\/gallery-carousel>/i)
  const fromCarousel = carousel ? collectImages(carousel[0]) : []
  return fromCarousel.length ? fromCarousel : collectImages(text)
}

function mimeFor(ext) {
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function epochSeconds(stamp) {
  const iso = String(stamp || '')
    .replace(/\.(\d{3})\d*/, '.$1')
    .replace(/([+-]\d\d)(\d\d)$/, '$1:$2')
  const ms = Date.parse(iso)
  return ms > 0 ? ms / 1000 : 0
}

function countOf(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return isFinite(n) ? n : null
}

function withMeta(data, meta) {
  if (meta.author) data.author = meta.author
  if (meta.score != null) data.score = meta.score
  if (meta.comments != null) data.num_comments = meta.comments
  if (meta.created) data.created_utc = meta.created
  if (meta.permalink) data.permalink = meta.permalink
  return data
}

function feedMeta(tag) {
  return {
    author: attr(tag, 'author'),
    score: countOf(attr(tag, 'score')),
    comments: countOf(attr(tag, 'comment-count')),
    created: epochSeconds(attr(tag, 'created-timestamp')),
    permalink: attr(tag, 'permalink')
  }
}

function searchMeta(slice) {
  const author = slice.match(/"profile"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/)
  const counts = slice.match(
    /search-counter-row[\s\S]*?<faceplate-number[^>]*\bnumber="(\d+)"[\s\S]*?<faceplate-number[^>]*\bnumber="(\d+)"/
  )
  const stamp = slice.match(/<faceplate-timeago[^>]*\bts="([^"]+)"/)
  const link = slice.match(/href="(\/r\/[^"/]+\/comments\/[^"]+)"/)
  return {
    author: author ? author[1] : '',
    score: counts ? countOf(counts[1]) : null,
    comments: counts ? countOf(counts[2]) : null,
    created: stamp ? epochSeconds(stamp[1]) : 0,
    permalink: link ? link[1] : ''
  }
}

function parsePosts(html) {
  if (!html || html.includes('Prove your humanity') || !html.includes('<shreddit-post')) {
    return null
  }

  const children = []
  const seen = new Set()
  for (const part of html.split(/<shreddit-post(?=[\s>])/).slice(1)) {
    const split = splitTag(part)
    if (!split) continue
    const tag = split.tag
    const rest = split.rest
    if (/\bpromoted\b/i.test(tag)) continue

    const name = attr(tag, 'id')
    if (!name || seen.has(name)) continue
    const type = attr(tag, 'post-type')
    if (type === 'text' || type === 'self') continue

    const title = attr(tag, 'post-title')
    const href = attr(tag, 'content-href')
    const closeAt = rest.indexOf('</shreddit-post>')
    const body = closeAt > 0 ? rest.slice(0, closeAt) : rest
    const images = type === 'gallery' ? galleryImages(tag + body) : imageFiles(tag + body)
    const nsfw = /\bnsfw\b/i.test(tag)
    const slug = redgifsSlug(tag + body)
    const meta = feedMeta(tag)

    if (type === 'gallery' && images.length) {
      seen.add(name)
      const media_metadata = {}
      for (const image of images) {
        media_metadata[image.id] = {
          status: 'valid',
          e: 'Image',
          m: mimeFor(image.ext),
          s: { u: image.url },
          p: [{ x: 1080, u: image.url }]
        }
      }
      children.push({
        data: withMeta({
          name,
          title,
          url: images[0].url,
          is_self: false,
          over_18: nsfw,
          is_gallery: true,
          gallery_data: { items: images.map((image) => ({ media_id: image.id })) },
          media_metadata
        }, meta)
      })
      continue
    }

    if (slug) {
      seen.add(name)
      const data = withMeta({
        name,
        title,
        url: 'https://www.redgifs.com/watch/' + slug,
        is_self: false,
        over_18: nsfw
      }, meta)
      const poster = coverUrl(tag + body)
      if (poster) data.preview = { images: [{ source: { url: poster } }] }
      children.push({ data })
      continue
    }

    const direct = images[0] ? images[0].url : /^https?:\/\/i\.redd\.it\//i.test(href) ? href : ''
    if (!direct) continue
    seen.add(name)
    children.push({
      data: withMeta({
        name,
        title,
        url: direct,
        is_self: false,
        over_18: nsfw
      }, meta)
    })
  }

  return children
}

function trackerSlice(html, thingIndex) {
  const start = html.lastIndexOf('<search-telemetry-tracker', thingIndex)
  if (start < 0) return ''
  const open = '<search-telemetry-tracker'
  const close = '</search-telemetry-tracker>'
  let depth = 0
  let i = start
  while (i < html.length) {
    const nextOpen = html.indexOf(open, i)
    const nextClose = html.indexOf(close, i)
    if (nextClose < 0) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + open.length
      continue
    }
    depth--
    i = nextClose + close.length
    if (depth === 0) return html.slice(start, i)
  }
  return ''
}

function parseSearchPosts(html) {
  if (!html || html.indexOf('Prove your humanity') !== -1) return null
  if (html.indexOf('data-thingid="t3_') === -1) return []
  const children = []
  const seen = new Set()
  const re = /data-thingid="(t3_[a-z0-9]+)"/gi
  let match
  while ((match = re.exec(html))) {
    const name = match[1]
    if (seen.has(name)) continue
    const slice = decodeEntities(trackerSlice(html, match.index))
    if (!slice) continue
    const titleMatch = slice.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)
    const title = titleMatch
      ? titleMatch[1]
          .replace(/\\"/g, '"')
          .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      : ''
    const nsfw = /"nsfw"\s*:\s*true/.test(slice.slice(0, 2500))
    const slug = redgifsSlug(slice)
    const images = collectImages(slice)
    const meta = searchMeta(slice)
    if (slug) {
      seen.add(name)
      const poster = coverUrl(slice) || (images[0] ? images[0].url : '')
      const data = withMeta({
        name: name,
        title: title,
        url: 'https://www.redgifs.com/watch/' + slug,
        is_self: false,
        over_18: nsfw
      }, meta)
      if (poster) data.preview = { images: [{ source: { url: poster } }] }
      children.push({ data: data })
      continue
    }
    const direct = images[0] ? images[0].url : ''
    if (!direct) continue
    seen.add(name)
    if (images.length > 1) {
      const media_metadata = {}
      for (let i = 0; i < images.length; i++) {
        const image = images[i]
        media_metadata[image.id] = {
          status: 'valid',
          e: 'Image',
          m: mimeFor(image.ext),
          s: { u: image.url },
          p: [{ x: 1080, u: image.url }]
        }
      }
      const items = []
      for (let i = 0; i < images.length; i++) items.push({ media_id: images[i].id })
      children.push({
        data: withMeta({
          name: name,
          title: title,
          url: direct,
          is_self: false,
          over_18: nsfw,
          is_gallery: true,
          gallery_data: { items: items },
          media_metadata: media_metadata
        }, meta)
      })
      continue
    }
    children.push({
      data: withMeta({
        name: name,
        title: title,
        url: direct,
        is_self: false,
        over_18: nsfw
      }, meta)
    })
  }
  return children
}

const PARTIAL = 'text/vnd.reddit.partial+html, text/html'
const PAGE_TARGET = 50
const MAX_PAGES = 4
function encodeBase64(value) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i)
    const b = i + 1 < value.length ? value.charCodeAt(i + 1) : 0
    const c = i + 2 < value.length ? value.charCodeAt(i + 2) : 0
    const triple = (a << 16) | (b << 8) | c
    out += chars[(triple >> 18) & 63]
    out += chars[(triple >> 12) & 63]
    out += i + 1 < value.length ? chars[(triple >> 6) & 63] : '='
    out += i + 2 < value.length ? chars[triple & 63] : '='
  }
  return out
}

function header(name) {
  const headers = ($request && $request.headers) || {}
  const want = name.toLowerCase()
  const keys = Object.keys(headers)
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === want) return headers[keys[i]] || ''
  }
  return ''
}

// Dev servers on this machine or the LAN, e.g. a phone opening http://192.168.1.5:5173.
function devHost(host) {
  if (host === 'localhost' || host === '127.0.0.1' || /\.local$/.test(host)) return true
  const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)
  if (!ip) return false
  const a = Number(ip[1])
  const b = Number(ip[2])
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function fromMatrix() {
  const source = header('Origin') || header('Referer')
  const match = /^(https?):\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(source)
  if (!match) return false
  const host = match[2].toLowerCase()
  if (host === 'icorale.github.io') return match[1].toLowerCase() === 'https'
  return devHost(host)
}

function queryParam(query, name) {
  if (!query) return ''
  const match = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(query)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' '))
  } catch (err) {
    return ''
  }
}

function feedUrlFromAppUrl(appUrl) {
  const match = /^https?:\/\/[^/]+(\/[^?#]*)(?:\?([^#]*))?/i.exec(appUrl)
  if (!match) return null
  const pathMatch = /\/r\/([^/]+)\/([^/]+)\.json$/.exec(match[1])
  if (!pathMatch) return null
  const kind = pathMatch[2]
  const target = {
    subreddit: decodeURIComponent(pathMatch[1]),
    kind: kind,
    after: queryParam(match[2], 'after'),
    query: queryParam(match[2], 'q'),
    sort: queryParam(match[2], 'sort'),
    range: queryParam(match[2], 't')
  }
  if (kind === 'search' && !target.query) return null
  return target
}

function searchSort(sort) {
  if (sort === 'best') return 'relevance'
  if (sort === 'rising') return 'hot'
  if (
    sort === 'relevance' ||
    sort === 'hot' ||
    sort === 'new' ||
    sort === 'top' ||
    sort === 'comments'
  ) {
    return sort
  }
  return 'relevance'
}

function searchPageUrl(target, cursor) {
  let url =
    'https://www.reddit.com/svc/shreddit/r/' +
    encodeURIComponent(target.subreddit) +
    '/search/?q=' +
    encodeURIComponent(target.query) +
    '&type=posts&sort=' +
    encodeURIComponent(searchSort(target.sort))
  if (cursor) url += '&cursor=' + encodeURIComponent(cursor)
  return url
}

function nextSearchCursor(html, current) {
  const text = html.replace(/&amp;/g, '&')
  const re = /[?&]cursor=([^"'&\s]+)/g
  let match
  while ((match = re.exec(text))) {
    let value = match[1]
    try {
      value = decodeURIComponent(value)
    } catch (err) {
      continue
    }
    if (value && value !== current) return value
  }
  return ''
}

function hash32(text, seed) {
  let hash = seed
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash, 33) ^ text.charCodeAt(i)
  return hash >>> 0
}

function cursorStoreKey(target, after) {
  const raw = target.subreddit + '\n' + target.query + '\n' + searchSort(target.sort) + '\n' + after
  return 'rms.' + hash32(raw, 5381).toString(16) + hash32(raw, 2166136261).toString(16)
}

function topRange(range) {
  if (
    range === 'hour' ||
    range === 'day' ||
    range === 'week' ||
    range === 'month' ||
    range === 'year' ||
    range === 'all'
  ) {
    return range
  }
  return 'day'
}

function feedUrlFor(target, after) {
  let url =
    'https://www.reddit.com/svc/shreddit/community-more-posts/' +
    encodeURIComponent(target.kind) +
    '/?name=' +
    encodeURIComponent(target.subreddit) +
    '&feedLength=' +
    PAGE_TARGET
  if (target.kind === 'top') url += '&t=' + topRange(target.range)
  if (after) url += '&after=' + encodeURIComponent(encodeBase64(after))
  return url
}

function httpGet(url, headers) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers, timeout: 20 }, (error, response, data) => {
      resolve({
        error: error || '',
        status: response && response.status,
        text: typeof data === 'string' ? data : ''
      })
    })
  })
}

function fetchFailed(res) {
  if (!res || res.error) return true
  if (typeof res.status === 'number' && (res.status < 200 || res.status >= 300)) return true
  return !res.text
}

const SEARCH_END = 'rm:end'

function rememberSearchCursors(target, posts, next) {
  const value = next || SEARCH_END
  for (let i = 0; i < posts.length; i++) {
    const name = posts[i] && posts[i].data ? posts[i].data.name : ''
    if (!name) continue
    $persistentStore.write(value, cursorStoreKey(target, name))
  }
}

async function searchBatch(target, after) {
  let cursor = ''
  if (after) {
    const saved = $persistentStore.read(cursorStoreKey(target, after)) || ''
    if (!saved) return null
    if (saved === SEARCH_END) return []
    cursor = saved
  }
  const fetched = await httpGet(searchPageUrl(target, cursor), {
    Accept: PARTIAL,
    'User-Agent': userAgent()
  })
  if (fetchFailed(fetched)) return null
  const posts = parseSearchPosts(fetched.text)
  if (!posts) return null
  rememberSearchCursors(target, posts, nextSearchCursor(fetched.text, cursor))
  return posts
}

async function postsFrom(target, after) {
  if (target.kind === 'search') return searchBatch(target, after)
  const fetched = await httpGet(feedUrlFor(target, after), {
    Accept: PARTIAL,
    'User-Agent': userAgent()
  })
  if (fetchFailed(fetched)) return null
  return parsePosts(fetched.text)
}

function userAgent() {
  const ua = header('User-Agent')
  if (ua && ua.length > 40 && /AppleWebKit|Chrome|Firefox|Safari\//.test(ua)) return ua
  return 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
}

let rgToken = ''
let rgTokenAt = 0
const RG_TOKEN_KEY = 'rm.rg.token'
const RG_TOKEN_AT_KEY = 'rm.rg.at'

function stillFromGif(gif) {
  const urls = (gif && gif.urls) || {}
  const candidates = [urls.thumbnail, urls.poster]
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i]
    if (typeof url !== 'string' || url.indexOf('https://') !== 0) continue
    if (/\.(mp4|webm|m3u8)(\?|$)/i.test(url)) continue
    return url
  }
  return ''
}

function videoFromGif(gif) {
  const urls = (gif && gif.urls) || {}
  const hd = urls.hd
  const sd = urls.sd
  if (typeof hd === 'string' && hd.indexOf('https://') === 0 && /\.mp4(\?|$)/i.test(hd)) return hd
  if (typeof sd === 'string' && sd.indexOf('https://') === 0 && /\.mp4(\?|$)/i.test(sd)) return sd
  return ''
}

function rememberToken(token) {
  rgToken = token
  rgTokenAt = Date.now()
  try {
    $persistentStore.write(token, RG_TOKEN_KEY)
    $persistentStore.write(String(rgTokenAt), RG_TOKEN_AT_KEY)
  } catch (err) {
    console.log(String(err))
  }
}

async function redgifsToken(force) {
  if (!force && rgToken && Date.now() - rgTokenAt < 10 * 60 * 1000) return rgToken
  if (!force) {
    const saved = $persistentStore.read(RG_TOKEN_KEY) || ''
    const at = Number($persistentStore.read(RG_TOKEN_AT_KEY) || '0')
    if (saved && at > 0 && Date.now() - at < 10 * 60 * 1000) {
      rgToken = saved
      rgTokenAt = at
      return rgToken
    }
  }
  const res = await httpGet('https://api.redgifs.com/v2/auth/temporary', {
    Accept: 'application/json',
    'User-Agent': userAgent()
  })
  let json = null
  if (res.text) {
    try {
      json = JSON.parse(res.text)
    } catch (err) {
      throw new Error('redgifs auth ' + (res.status || res.error) + ' ' + String(res.text).slice(0, 500))
    }
  }
  if (!json || !json.token) {
    throw new Error('redgifs auth ' + (res.status || res.error) + ' ' + String(res.text || '').slice(0, 500))
  }
  rememberToken(json.token)
  return rgToken
}

function requestDropped(res) {
  if (!res || res.error) return true
  return typeof res.status !== 'number' || res.status === 0
}

function posterSlug(appUrl) {
  const match = /[?&]slug=([^&]+)/.exec(appUrl || '')
  if (!match) return ''
  let slug = match[1]
  try {
    slug = decodeURIComponent(slug)
  } catch (err) {
    return ''
  }
  return /^[a-z0-9-]+$/i.test(slug) ? slug : ''
}

async function posterForSlug(slug, token) {
  const res = await httpGet('https://api.redgifs.com/v2/gifs/' + encodeURIComponent(slug), {
    Accept: 'application/json',
    Authorization: 'Bearer ' + token,
    'User-Agent': userAgent(),
    'x-customheader': 'https://www.redgifs.com/watch/' + slug
  })
  if (requestDropped(res)) return { dropped: true, poster: '' }
  if (res.status === 401) return { unauthorized: true, poster: '' }
  if (res.status < 200 || res.status >= 300) return { poster: '' }
  let json = null
  try {
    json = JSON.parse(res.text)
  } catch (err) {
    return { poster: '' }
  }
  const gif = json && json.gif
  return { poster: stillFromGif(gif), video: videoFromGif(gif) }
}

async function oneRedgifsPoster(appUrl) {
  const slug = posterSlug(appUrl)
  if (!slug) return null
  let token
  try {
    token = await redgifsToken(false)
  } catch (err) {
    console.log(String(err))
    return null
  }
  let result = await posterForSlug(slug, token)
  if (result.unauthorized) {
    try {
      token = await redgifsToken(true)
    } catch (err) {
      console.log(String(err))
      return null
    }
    result = await posterForSlug(slug, token)
  }
  if (result.dropped || result.unauthorized) return null
  return { url: result.poster || '', video: result.video || '' }
}

async function listingFor(appUrl) {
  const target = feedUrlFromAppUrl(appUrl)
  if (!target) return null

  const children = []
  const seen = {}
  let after = target.after
  for (let page = 0; page < MAX_PAGES && children.length < PAGE_TARGET; page++) {
    const batch = await postsFrom(target, after)
    if (batch == null) return children.length ? { data: { children: children } } : null
    if (!batch.length) break
    const before = children.length
    for (let i = 0; i < batch.length; i++) {
      if (target.kind !== 'search' && children.length >= PAGE_TARGET) break
      const name = batch[i] && batch[i].data && batch[i].data.name
      if (!name || seen[name]) continue
      seen[name] = true
      children.push(batch[i])
    }
    if (children.length === before) break
    if (children.length >= PAGE_TARGET) break
    if (target.kind === 'search') {
      const last = batch[batch.length - 1] && batch[batch.length - 1].data && batch[batch.length - 1].data.name
      if (last) after = last
    } else {
      after = children[children.length - 1].data.name
    }
  }
  if (!children.length) return { data: { children: [] } }
  return { data: { children: children } }
}

const NSFW_LIST_URL = 'https://theporndude.com/best-nsfw-reddit-sites'

function isNsfwDirectory(appUrl) {
  return /^https:\/\/theporndude\.com\/best-nsfw-reddit-sites\/?(\?|$)/i.test(appUrl || '')
}

function minorNamed(name) {
  const n = String(name).toLowerCase()
  if (n.indexOf('teen') !== -1 && n.indexOf('fifteen') === -1) return true
  if (n.indexOf('schoolgirl') !== -1) return true
  if (n.indexOf('jailbait') !== -1 || n.indexOf('underage') !== -1 || n.indexOf('preteen') !== -1)
    return true
  if (n.indexOf('barelylegal') !== -1 || n.indexOf('barely_legal') !== -1) return true
  if (n.indexOf('lolita') !== -1 || /(^|[^a-z])loli([^a-z]|$)/.test(n)) return true
  if (n.indexOf('shota') !== -1) return true
  if (n.indexOf('pedo') !== -1 && n.indexOf('torpedo') === -1) return true
  if (n.indexOf('fauxbait') !== -1) return true
  if (n.indexOf('child') !== -1) return true
  if (/(^|[^a-z])kids?([^a-z]|$)/.test(n)) return true
  if (/(^|[^a-z0-9])(1[0-9])([^a-z0-9]|$)/.test(n)) return true
  if (/[a-z](1[0-9])$/.test(n)) return true
  if (/^(1[0-9])/.test(n)) return true
  return false
}

function isPoster(appUrl) {
  return /^https:\/\/www\.reddit\.com\/svc\/rm\/redgifs-poster\.json(?:\?|$)/i.test(appUrl || '')
}

function isRelated(appUrl) {
  return /\/r\/[^/]+\/related\.json(?:\?|$)/i.test(appUrl || '')
}

function relatedSubreddit(appUrl) {
  const match = /\/r\/([^/]+)\/related\.json/i.exec(appUrl || '')
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch (err) {
    return match[1]
  }
}

function subredditLinkName(href) {
  const url = String(href || '')
    .replace(/&amp;/g, '&')
    .trim()
  const match =
    /^(?:https?:\/\/(?:(?:www|old|np)\.)?reddit\.com)?\/r\/([A-Za-z0-9_]+)\/?(?:[?#].*)?$/i.exec(url)
  return match ? match[1] : ''
}

function relatedNamesFromHtml(html, current) {
  const names = []
  const seen = {}
  const currentKey = String(current || '').toLowerCase()
  function add(name) {
    if (!name || !/^[A-Za-z0-9_]+$/.test(name)) return
    const key = name.toLowerCase()
    if (key === currentKey || seen[key] || minorNamed(name)) return
    seen[key] = true
    names.push(name)
  }
  const widget = /source="subreddit_list_widget"[\s\S]{0,800}?name="([A-Za-z0-9_]+)"/gi
  let match
  while ((match = widget.exec(html))) add(match[1])
  const menu =
    /<faceplate-tracker\b[^>]*\bsource="community_menu"[^>]*>[\s\S]*?<\/faceplate-tracker>/gi
  while ((match = menu.exec(html))) {
    const href = /href="([^"]+)"/i.exec(match[0])
    if (href) add(subredditLinkName(href[1]))
  }
  return names
}

function railBlocked(html) {
  return !html || /Prove your humanity|g-recaptcha|blocked by network security/i.test(html)
}

function nsfwNamesFromHtml(html) {
  const names = []
  const seen = {}
  const re = /data-external-link="https?:\/\/(?:www\.)?reddit\.com\/r\/([^"/?#]+)\/?"/gi
  let match
  while ((match = re.exec(html))) {
    const name = match[1]
    if (!name || seen[name] || minorNamed(name)) continue
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue
    seen[name] = true
    names.push(name)
  }
  return names
}

function jsonResponse(status, body) {
  $done({
    response: {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      },
      body
    }
  })
}

const argument = typeof $argument === 'string' ? $argument : ''
const appUrl = argument.indexOf('http') === 0 ? argument : $request && $request.url
if (header('X-RM-Direct') === '1') {
  $done({})
} else if (argument.indexOf('http') !== 0 && !fromMatrix()) {
  $done({})
} else if (isPoster(appUrl)) {
  oneRedgifsPoster(appUrl)
    .then((body) => {
      const slug = posterSlug(appUrl)
      if (!body) {
        console.log('reddit-matrix poster failed ' + slug)
        jsonResponse(502, JSON.stringify({ error: true }))
        return
      }
      console.log(
        'reddit-matrix poster ' +
          (body.url ? 'ok ' : 'empty ') +
          (body.video ? 'hd ' : 'no-video ') +
          slug
      )
      jsonResponse(200, JSON.stringify(body))
    })
    .catch((err) => {
      console.log('reddit-matrix poster ' + err)
      jsonResponse(502, JSON.stringify({ error: true }))
    })
} else if (isRelated(appUrl)) {
  const relatedName = relatedSubreddit(appUrl)
  const railUrl =
    'https://www.reddit.com/svc/shreddit/feeds/subreddit-right-rail?name=' +
    encodeURIComponent(relatedName) +
    '&refresh=1'
  httpGet(railUrl, {
    'X-RM-Direct': '1',
    Accept: PARTIAL,
    'User-Agent': userAgent()
  })
    .then((res) => {
      if (!relatedName || fetchFailed(res) || railBlocked(res.text)) {
        console.log('reddit-matrix related failed ' + relatedName + ' ' + (res && res.status))
        jsonResponse(502, JSON.stringify({ error: true }))
        return
      }
      const names = relatedNamesFromHtml(res.text, relatedName)
      console.log(
        'reddit-matrix related ' + relatedName + ' ' + names.length + (names.length ? ' first ' + names[0] : '')
      )
      jsonResponse(200, JSON.stringify({ names: names }))
    })
    .catch((err) => {
      console.log('reddit-matrix related ' + err)
      jsonResponse(502, JSON.stringify({ error: true }))
    })
} else if (isNsfwDirectory(appUrl)) {
  httpGet(NSFW_LIST_URL, { 'X-RM-Direct': '1', Accept: 'text/html' })
    .then((res) => {
      if (fetchFailed(res)) {
        console.log('reddit-matrix nsfw failed ' + (res && res.status))
        jsonResponse(502, JSON.stringify({ error: true }))
        return
      }
      const names = nsfwNamesFromHtml(res.text)
      if (!names.length) {
        console.log('reddit-matrix nsfw empty')
        jsonResponse(502, JSON.stringify({ error: true }))
        return
      }
      console.log('reddit-matrix nsfw ' + names.length + ' first ' + names[0])
      jsonResponse(200, JSON.stringify({ names: names }))
    })
    .catch((err) => {
      console.log('reddit-matrix nsfw ' + err)
      jsonResponse(502, JSON.stringify({ error: true }))
    })
} else {
  listingFor(appUrl)
    .then((body) => {
      if (!body || !body.data || !Array.isArray(body.data.children)) {
        console.log('reddit-matrix failed ' + appUrl)
        jsonResponse(502, JSON.stringify({ error: true }))
        return
      }
      const count = body.data.children.length
      const text = JSON.stringify(body)
      console.log(
        'reddit-matrix ' +
          count +
          ' bytes ' +
          text.length +
          (count ? ' first ' + body.data.children[0].data.name : ' empty')
      )
      jsonResponse(200, text)
    })
    .catch((err) => {
      console.log('reddit-matrix ' + err)
      jsonResponse(502, JSON.stringify({ error: true }))
    })
}
