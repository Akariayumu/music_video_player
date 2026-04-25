const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// API key from env or fallback
const KUWO_API_KEY = process.env.KUWO_API_KEY || 'dv8JqaGywPNfPG4g1bK';

app.use(cors());
app.use(express.json());

// Lazy-load NeteaseCloudMusicApi
let NeteaseAPI = null;
async function getAPI() {
  if (!NeteaseAPI) {
    NeteaseAPI = require('NeteaseCloudMusicApi');
  }
  return NeteaseAPI;
}

/**
 * Generic JSON fetch using native fetch (Node.js 18+).
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<any>}
 */
async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...options.headers,
    },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Generic retry wrapper with exponential backoff.
 * @param {Function} fn - Async function to retry
 * @param {number} [maxRetries=3]
 * @param {number} [baseDelay=500]
 * @returns {Promise<any>}
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Generic Kuwo API request.
 * @param {object} params - Query params for Kuwo API
 * @returns {Promise<object>}
 */
async function kuwoRequest(params) {
  const qs = new URLSearchParams({ key: KUWO_API_KEY, ...params }).toString();
  return jsonFetch(`https://api.yaohud.cn/api/music/kuwo?${qs}`);
}

/**
 * Generic audio proxy handler — merges kuwo/netease handlers.
 * @param {string} sourceUrl
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} [extraHeaders]
 */
function proxyAudio(sourceUrl, req, res, extraHeaders = {}) {
  const urlObj = new URL(sourceUrl);
  const protocol = urlObj.protocol === 'https:' ? require('https') : require('http');

  protocol.get(sourceUrl, { headers: { ...extraHeaders } }, (audioRes) => {
    res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mpeg');
    if (audioRes.headers['content-length']) {
      res.setHeader('Content-Length', audioRes.headers['content-length']);
    }
    if (audioRes.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', audioRes.headers['accept-ranges']);
    }
    res.statusCode = audioRes.statusCode || 200;
    audioRes.pipe(res);
  }).on('error', (err) => {
    if (!res.headersSent) res.status(500).send('Proxy error: ' + err.message);
  });
}

// ==================== Netease Cloud Music Routes ====================

// Search songs
app.get('/api/search', async (req, res) => {
  try {
    const api = await getAPI();
    const { keywords, limit = 20, offset = 0 } = req.query;
    if (!keywords) return res.json({ code: 400, message: 'keywords required' });

    const result = await api.search({ keywords, limit: parseInt(limit), offset: parseInt(offset), cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get song URL
app.get('/api/song/url', async (req, res) => {
  try {
    const api = await getAPI();
    const { id, br = 128000, name, artist } = req.query;
    if (!id) return res.json({ code: 400, message: 'id required' });

    const result = await api.song_url({ id, br: parseInt(br), cookie: '' });
    const body = result.body || result;
    const item = (body.data || [])[0];

    // If Netease returned a URL, use it
    if (item?.url) {
      return res.json(body);
    }

    // Fallback: use yaohud Kuwo API (works from overseas)
    if (name) {
      try {
        const msg = artist ? `${name} ${artist}` : name;
        const sizeMap = { 128000: 'standard', 320000: 'exhigh', 999000: 'SQ' };
        const size = sizeMap[parseInt(br)] || 'standard';
        const kuwoData = await kuwoRequest({ msg, n: 1, size });
        const kuwoUrl = kuwoData?.data?.vipmusic?.url || null;
        if (kuwoUrl) {
          console.log(`[song/url] Netease returned null for "${name}", using Kuwo fallback`);
          return res.json({
            code: 200,
            data: [{ id, url: kuwoUrl, br: parseInt(br), source: 'kuwo' }],
          });
        }
      } catch (kuwoErr) {
        console.error('Kuwo fallback error:', kuwoErr.message);
      }
    }

    // All sources failed
    res.json(body);
  } catch (err) {
    console.error('Song URL error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get song detail
app.get('/api/song/detail', async (req, res) => {
  try {
    const api = await getAPI();
    const { ids } = req.query;
    if (!ids) return res.json({ code: 400, message: 'ids required' });

    const result = await api.song_detail({ ids, cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    console.error('Song detail error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get lyrics
app.get('/api/lyric', async (req, res) => {
  try {
    const api = await getAPI();
    const { id } = req.query;
    if (!id) return res.json({ code: 400, message: 'id required' });

    const result = await api.lyric({ id, cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    console.error('Lyric error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get hot search
app.get('/api/search/hot', async (req, res) => {
  try {
    const api = await getAPI();
    const result = await api.search_hot_detail({ cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    console.error('Hot search error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get artist songs
app.get('/api/artist/songs', async (req, res) => {
  try {
    const api = await getAPI();
    const { id, limit = 50 } = req.query;
    const result = await api.artist_songs({ id, limit: parseInt(limit), cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Playlist detail
app.get('/api/playlist/detail', async (req, res) => {
  try {
    const api = await getAPI();
    const { id } = req.query;
    if (!id) return res.json({ code: 400, message: 'id required' });
    const result = await api.playlist_detail({ id, cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    console.error('Playlist detail error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Playlist tracks
app.get('/api/playlist/track/all', async (req, res) => {
  try {
    const api = await getAPI();
    const { id, limit = 50 } = req.query;
    const result = await api.playlist_track_all({ id, limit: parseInt(limit), cookie: '' });
    res.json(result.body || result);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ==================== Kuwo Routes ====================

// Search Kuwo songs
app.get('/api/search/kuwo', async (req, res) => {
  try {
    const { keywords } = req.query;
    if (!keywords) return res.json({ code: 400, message: 'keywords required' });
    const data = await kuwoRequest({ msg: keywords, size: 'standard' });
    res.json(data);
  } catch (err) {
    console.error('Kuwo search error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get Kuwo song play URL by keywords and quality
app.get('/api/song/url/kuwo', async (req, res) => {
  try {
    const { keywords, size = 'standard' } = req.query;
    if (!keywords) return res.json({ code: 400, message: 'keywords required' });

    const data = await kuwoRequest({ msg: keywords, size });
    const songs = data?.data?.songs || [];
    const playUrl = songs[0]?.url || songs[0]?.mp3Url || null;
    res.json({ code: 200, url: playUrl });
  } catch (err) {
    console.error('Kuwo URL error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get Kuwo song detail (cover + URL) by keywords and index
app.get('/api/kuwo/detail', async (req, res) => {
  try {
    const { msg, n = 1, size = 'standard' } = req.query;
    if (!msg) return res.json({ code: 400, message: 'msg required' });

    const data = await kuwoRequest({ msg, n, size });

    // Handle Kuwo API error (code can be string "400" or number 400)
    if (data.code == 400 || data.code === '400') {
      return res.json({ code: 404, message: data.msg || '未找到歌曲', picture: '', url: null });
    }

    const result = data?.data || {};
    res.json({
      code: 200,
      picture: result.picture || '',
      url: result.vipmusic?.url || null
    });
  } catch (err) {
    console.error('Kuwo detail error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Proxy Kuwo audio stream to bypass CORS
app.get('/api/kuwo/audio', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url parameter required');
  proxyAudio(url, req, res);
});

// Proxy NetEase audio stream to bypass CORS
app.get('/api/netease/audio', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url parameter required');
  proxyAudio(url, req, res, { 'Referer': 'https://music.163.com/' });
});

// ==================== Bilibili Routes ====================

// Bilibili video search with fallback
app.get('/api/bilibili', async (req, res) => {
  try {
    const { msg } = req.query;
    if (!msg) return res.json({ code: 400, message: 'msg required' });

    const httpsGet = (url) => jsonFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    // Try yaohud v5 API, attempt n=1 to n=3 until we get a BV number (with retry wrapper)
    const result = await withRetry(async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const url = `https://api.yaohud.cn/api/v5/bilibili?key=${KUWO_API_KEY}&msg=${encodeURIComponent(msg)}&n=${attempt}`;
        const json = await httpsGet(url);
        if (json.code === 200 && (json.data?.url || '').match(/BV[\w]+/)) {
          return json;
        }
      }
      throw new Error('No valid BV found via yaohud');
    }, 1, 500);

    if (result) return res.json(result);

    // Fallback: B站官方搜索 API
    try {
      const biliUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(msg)}`;
      const biliData = await httpsGet(biliUrl);
      const results = biliData?.data?.result || [];
      for (const item of results.slice(0, 5)) {
        if (item.bvid) {
          return res.json({
            code: 200,
            data: {
              url: `https://www.bilibili.com/video/${item.bvid}`,
              title: (item.title || msg).replace(/<[^>]+>/g, ''),
              bvid: item.bvid
            }
          });
        }
      }
    } catch (e) {
      console.error('Bilibili official API failed:', e.message);
    }

    res.json({ code: 404, message: '未找到相关视频' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Bilibili video parse via yaohud v6 API (returns MP4 direct link)
app.get('/api/bilibili/mir6', async (req, res) => {
  try {
    const { bvid } = req.query;
    if (!bvid) return res.json({ code: 400, message: 'bvid required' });

    const biliUrl = `https://www.bilibili.com/video/${bvid}`;
    const apiUrl = `https://api.yaohud.cn/api/v6/video/bili?key=${KUWO_API_KEY}&url=${encodeURIComponent(biliUrl)}`;

    // Use native fetch instead of execSync('curl')
    const data = await jsonFetch(apiUrl);

    const videoUrl = data.data?.video_url;
    if (!videoUrl) {
      return res.json({ code: 404, message: '解析失败，未获取到视频链接' });
    }

    res.json({
      code: 200,
      video_url: videoUrl,
      accept: ['高清 720P']
    });
  } catch (err) {
    console.error('Bili parse error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ==================== Netease WeAPI Proxy ====================
// Browser sends encrypted params; server forwards to music.163.com
// This bypasses CORS while keeping encryption logic client-side
app.post('/api/netease/weapi', async (req, res) => {
  try {
    const { path, params, encSecKey } = req.body;
    if (!path || !params || !encSecKey) {
      return res.status(400).json({ code: 400, message: 'Missing path/params/encSecKey' });
    }
    const form = new URLSearchParams({ params, encSecKey });
    const response = await fetch(`https://music.163.com/weapi${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://music.163.com/',
      },
      body: form.toString(),
    });
    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (err) {
    console.error('Netease weapi proxy error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ==================== Health Check ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==================== Static Files ====================

app.use(express.static(path.join(__dirname), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎵 Music Player running at: http://localhost:${PORT}\n`);
  console.log('  Open your browser and enjoy the music!\n');
});
