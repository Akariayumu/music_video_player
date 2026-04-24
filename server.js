const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Search songs
app.get('/api/search', async (req, res) => {
  try {
    const api = await getAPI();
    const { keywords, limit = 20, offset = 0 } = req.query;
    if (!keywords) return res.json({ code: 400, message: 'keywords required' });

    const result = await api.search({
      keywords,
      limit: parseInt(limit),
      offset: parseInt(offset),
      cookie: ''
    });
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
    const { id, br = 128000 } = req.query;
    if (!id) return res.json({ code: 400, message: 'id required' });

    const result = await api.song_url({
      id,
      br: parseInt(br),
      cookie: ''
    });
    res.json(result.body || result);
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

    const result = await api.song_detail({
      ids,
      cookie: ''
    });
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

// Search Kuwo songs
app.get('/api/search/kuwo', async (req, res) => {
  try {
    const { keywords } = req.query;
    if (!keywords) return res.json({ code: 400, message: 'keywords required' });

    const https = require('https');
    const url = `https://api.yaohud.cn/api/music/kuwo?key=dv8JqaGywPNfPG4g1bK&msg=${encodeURIComponent(keywords)}&size=standard`;

    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    res.json(data);
  } catch (err) {
    console.error('Kuwo search error:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get Kuwo song play URL by keywords and quality size
app.get('/api/song/url/kuwo', async (req, res) => {
  try {
    const { keywords, size = 'standard' } = req.query;
    if (!keywords) return res.json({ code: 400, message: 'keywords required' });

    const https = require('https');
    const url = `https://api.yaohud.cn/api/music/kuwo?key=dv8JqaGywPNfPG4g1bK&msg=${encodeURIComponent(keywords)}&size=${encodeURIComponent(size)}`;

    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

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

    const https = require('https');
    const url = `https://api.yaohud.cn/api/music/kuwo?key=dv8JqaGywPNfPG4g1bK&msg=${encodeURIComponent(msg)}&n=${n}&size=${encodeURIComponent(size)}`;

    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

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

  const https = require('https');
  const http = require('http');
  const client = url.startsWith('https') ? https : http;

  const request = client.get(url, (audioRes) => {
    res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mpeg');
    if (audioRes.headers['content-length']) {
      res.setHeader('Content-Length', audioRes.headers['content-length']);
    }
    if (audioRes.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', audioRes.headers['accept-ranges']);
    }
    res.statusCode = audioRes.statusCode || 200;
    audioRes.pipe(res);
  });
  request.on('error', (err) => {
    if (!res.headersSent) res.status(500).send('Proxy error: ' + err.message);
  });
});

// Proxy NetEase audio stream to bypass CORS
app.get('/api/netease/audio', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url parameter required');

  const https = require('https');
  const http = require('http');
  const client = url.startsWith('https') ? https : http;

  const request = client.get(url, { headers: { 'Referer': 'https://music.163.com/' } }, (audioRes) => {
    res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mpeg');
    if (audioRes.headers['content-length']) {
      res.setHeader('Content-Length', audioRes.headers['content-length']);
    }
    if (audioRes.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', audioRes.headers['accept-ranges']);
    }
    res.statusCode = audioRes.statusCode || 200;
    audioRes.pipe(res);
  });
  request.on('error', (err) => {
    if (!res.headersSent) res.status(500).send('Proxy error: ' + err.message);
  });
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

// Playlist detail (basic info: name, cover, description)
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

// Bilibili video search with fallback
app.get('/api/bilibili', async (req, res) => {
  try {
    const https = require('https');
    const { msg } = req.query;
    if (!msg) return res.json({ code: 400, message: 'msg required' });

    const apiKey = 'dv8JqaGywPNfPG4g1bK';

    const httpsGet = (url) => new Promise((resolve, reject) => {
      const options = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
      https.get(url, options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error')); }
        });
      }).on('error', reject);
    });

    // Try yaohud v5 API, attempt n=1 to n=3 until we get a BV number
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = `https://api.yaohud.cn/api/v5/bilibili?key=${apiKey}&msg=${encodeURIComponent(msg)}&n=${attempt}`;
        const json = await httpsGet(url);
        if (json.code === 200 && (json.data?.url || '').match(/BV[\w]+/)) {
          return res.json(json);
        }
      } catch (e) {
        console.error(`yaohud bilibili attempt ${attempt} failed:`, e.message);
      }
    }

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

    // Use yaohud API via curl
    const biliUrl = `https://www.bilibili.com/video/${bvid}`;
    const apiKey = 'dv8JqaGywPNfPG4g1bK';
    const apiUrl = `https://api.yaohud.cn/api/v6/video/bili?key=${apiKey}&url=${encodeURIComponent(biliUrl)}`;
    
    const { execSync } = require('child_process');
    const result = execSync(`curl -s "${apiUrl}"`, { encoding: 'utf8', timeout: 15000 });
    console.log('API URL:', apiUrl);
    console.log('Result:', result.slice(0, 200));
    const data = JSON.parse(result);

    console.log('Bili parse response:', JSON.stringify(data).slice(0, 100));
    
    // Check if response has data.video_url
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Static files (after API routes)
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
