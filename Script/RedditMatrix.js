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

function coverUrl(html) {
  const text = decodeEntities(html)
  const patterns = [
    /https:\/\/(?:external-preview|preview)\.redd\.it\/[^\s"'<>]+/i,
    /https:\/\/media\.redgifs\.com\/[^\s"'<>]+-poster\.[a-z0-9]+/i,
    /https:\/\/thumbs\d*\.redgifs\.com\/[^\s"'<>]+/i,
    /https:\/\/i\.redd\.it\/[a-z0-9]+\.(?:jpe?g|png|gif|webp)/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0]
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
        data: {
          name,
          title,
          url: images[0].url,
          is_self: false,
          over_18: nsfw,
          is_gallery: true,
          gallery_data: { items: images.map((image) => ({ media_id: image.id })) },
          media_metadata
        }
      })
      continue
    }

    if (slug) {
      seen.add(name)
      const data = {
        name,
        title,
        url: 'https://www.redgifs.com/watch/' + slug,
        is_self: false,
        over_18: nsfw
      }
      const poster = coverUrl(tag + body)
      if (poster) data.preview = { images: [{ source: { url: poster } }] }
      children.push({ data })
      continue
    }

    const direct = images[0] ? images[0].url : /^https?:\/\/i\.redd\.it\//i.test(href) ? href : ''
    if (!direct) continue
    seen.add(name)
    children.push({
      data: {
        name,
        title,
        url: direct,
        is_self: false,
        over_18: nsfw
      }
    })
  }

  return children
}

const PARTIAL = 'text/vnd.reddit.partial+html, text/html'
const PAGE_TARGET = 50
const MAX_PAGES = 4
const ALLOWED = ['https://icorale.github.io', 'http://localhost', 'http://127.0.0.1']

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

function fromMatrix() {
  const source = header('Origin') || header('Referer')
  for (let i = 0; i < ALLOWED.length; i++) {
    if (source.indexOf(ALLOWED[i]) === 0) return true
  }
  return false
}

function feedUrlFromAppUrl(appUrl) {
  const match = /^https?:\/\/[^/]+(\/[^?#]*)(?:\?([^#]*))?/i.exec(appUrl)
  if (!match) return null
  const pathMatch = /\/r\/([^/]+)\/([^/]+)\.json$/.exec(match[1])
  if (!pathMatch || pathMatch[2] === 'search') return null
  let after = ''
  const query = match[2] ? /(^|&)after=([^&]*)/.exec(match[2]) : null
  if (query) after = decodeURIComponent(query[2].replace(/\+/g, ' '))
  return {
    subreddit: decodeURIComponent(pathMatch[1]),
    kind: pathMatch[2],
    after
  }
}

function feedUrlFor(target, after) {
  let url =
    'https://www.reddit.com/svc/shreddit/community-more-posts/' +
    encodeURIComponent(target.kind) +
    '/?name=' +
    encodeURIComponent(target.subreddit) +
    '&feedLength=' +
    PAGE_TARGET
  if (target.kind === 'top') url += '&t=day'
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

function userAgent() {
  const ua = header('User-Agent')
  if (ua && ua.length > 40 && /AppleWebKit|Chrome|Firefox|Safari\//.test(ua)) return ua
  return 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
}

let rgToken = ''
let rgTokenAt = 0

function watchSlug(child) {
  const url = child && child.data && child.data.url ? child.data.url : ''
  const match = /redgifs\.com\/watch\/([a-z0-9-]+)/i.exec(url)
  return match ? match[1] : ''
}

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

async function redgifsToken(force) {
  if (!force && rgToken && Date.now() - rgTokenAt < 10 * 60 * 1000) return rgToken
  const res = await httpGet('https://api.redgifs.com/v2/auth/temporary', {
    Accept: 'application/json'
  })
  const json = res.text ? JSON.parse(res.text) : null
  if (!json || !json.token) throw new Error('redgifs auth ' + (res.status || res.error))
  rgToken = json.token
  rgTokenAt = Date.now()
  return rgToken
}

async function posterForSlug(slug, token) {
  const res = await httpGet('https://api.redgifs.com/v2/gifs/' + encodeURIComponent(slug), {
    Accept: 'application/json',
    Authorization: 'Bearer ' + token,
    'x-customheader': 'https://www.redgifs.com/watch/' + slug
  })
  if (res.status === 401) return { unauthorized: true, poster: '' }
  if (res.status < 200 || res.status >= 300) return { unauthorized: false, poster: '' }
  let json = null
  try {
    json = JSON.parse(res.text)
  } catch (err) {
    return { unauthorized: false, poster: '' }
  }
  return { unauthorized: false, poster: stillFromGif(json && json.gif) }
}

async function attachRedgifsPosters(children) {
  const need = []
  for (let i = 0; i < children.length; i++) {
    if (watchSlug(children[i])) need.push(children[i])
  }
  if (!need.length) return

  let token
  try {
    token = await redgifsToken(false)
  } catch (err) {
    console.log(String(err))
    return
  }

  const missed = []
  await Promise.all(
    need.map(async (child) => {
      try {
        const result = await posterForSlug(watchSlug(child), token)
        if (result.unauthorized) missed.push(child)
        else if (result.poster) {
          child.data.preview = { images: [{ source: { url: result.poster } }] }
        }
      } catch (err) {
        console.log(String(err))
      }
    })
  )
  if (!missed.length) return

  try {
    token = await redgifsToken(true)
  } catch (err) {
    console.log(String(err))
    return
  }
  await Promise.all(
    missed.map(async (child) => {
      try {
        const result = await posterForSlug(watchSlug(child), token)
        if (result.poster) {
          child.data.preview = { images: [{ source: { url: result.poster } }] }
        }
      } catch (err) {
        console.log(String(err))
      }
    })
  )
}

async function listingFor(appUrl) {
  const target = feedUrlFromAppUrl(appUrl)
  if (!target) return null

  const children = []
  const seen = {}
  let after = target.after
  for (let page = 0; page < MAX_PAGES && children.length < PAGE_TARGET; page++) {
    const fetched = await httpGet(feedUrlFor(target, after), {
      Accept: PARTIAL,
      'User-Agent': userAgent()
    })
    const batch = parsePosts(fetched.text)
    if (!batch || !batch.length) break
    const before = children.length
    for (let i = 0; i < batch.length && children.length < PAGE_TARGET; i++) {
      const name = batch[i] && batch[i].data && batch[i].data.name
      if (!name || seen[name]) continue
      seen[name] = true
      children.push(batch[i])
    }
    if (children.length === before) break
    after = children[children.length - 1].data.name
  }
  if (!children.length) return null
  await attachRedgifsPosters(children)
  return { data: { children } }
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
if (argument.indexOf('http') !== 0 && !fromMatrix()) {
  $done({})
} else {
  listingFor(appUrl)
    .then((body) => {
      if (!body) {
        console.log('reddit-matrix empty ' + appUrl)
        jsonResponse(502, JSON.stringify({ data: { children: [] } }))
        return
      }
      const text = JSON.stringify(body)
      console.log(
        'reddit-matrix ' +
          body.data.children.length +
          ' bytes ' +
          text.length +
          ' first ' +
          body.data.children[0].data.name
      )
      jsonResponse(200, text)
    })
    .catch((err) => {
      console.log('reddit-matrix ' + err)
      jsonResponse(502, JSON.stringify({ data: { children: [] } }))
    })
}
