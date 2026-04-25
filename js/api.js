/**
 * @module api - Unified API client with timeout, retry, cancellation, and caching.
 * @typedef {Object} ApiOptions
 * @property {number} [timeout=15000] - Request timeout in ms
 * @property {number} [retries=1] - Number of retries on failure
 * @property {number} [retryDelay=500] - Base delay between retries (ms)
 * @property {AbortSignal} [signal] - AbortController signal for cancellation
 * @property {string} [cacheKey] - If set, cache the response under this key
 * @property {number} [cacheTTL=300000] - Cache time-to-live in ms (default 5min)
 */

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_CACHE_TTL = 300000; // 5 minutes

/** @type {Map<string, {data: any, expiry: number}>} */
const _cache = new Map();

/** @type {Map<string, Promise<any>>} - In-flight deduplication */
const _pending = new Map();

/** @type {Map<string, AbortController>} - Abortable requests by key */
const _controllers = new Map();

/**
 * Cancel all pending requests matching a prefix.
 * @param {string} prefix - Abort key prefix (e.g., 'search:')
 */
export function cancelRequests(prefix) {
  for (const [key, ctrl] of _controllers) {
    if (key.startsWith(prefix)) {
      ctrl.abort();
      _controllers.delete(key);
    }
  }
}

/**
 * Cancel a specific request by key.
 * @param {string} key
 */
export function cancelRequest(key) {
  const ctrl = _controllers.get(key);
  if (ctrl) {
    ctrl.abort();
    _controllers.delete(key);
  }
}

/**
 * Get or create an AbortController for a given key.
 * @param {string} key
 * @returns {AbortController}
 */
function getController(key) {
  // Cancel any existing request with same key
  cancelRequest(key);
  const ctrl = new AbortController();
  _controllers.set(key, ctrl);
  return ctrl;
}

/**
 * Unified fetch with timeout, retry, and optional caching.
 * @param {string} url
 * @param {ApiOptions} [options]
 * @returns {Promise<any>} JSON response
 */
export async function apiFetch(url, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
  const cacheKey = options.cacheKey;
  const cacheTTL = options.cacheTTL ?? DEFAULT_CACHE_TTL;

  // Check cache first
  if (cacheKey) {
    const cached = _cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
  }

  // Dedup: if same request is in-flight, return that promise
  const dedupKey = cacheKey || url;
  if (_pending.has(dedupKey)) {
    return _pending.get(dedupKey);
  }

  const controller = options.signal || getController(dedupKey);
  const signal = controller.signal;

  const doFetch = async () => {
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const fetchOpts = { signal, method: options.method || 'GET' };
      if (options.body) fetchOpts.body = options.body;
      if (options.headers) fetchOpts.headers = { ...options.headers };
      const response = await fetch(url, fetchOpts);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Cache successful responses
      if (cacheKey) {
        _cache.set(cacheKey, { data, expiry: Date.now() + cacheTTL });
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Request cancelled');
      }
      throw err;
    } finally {
      _controllers.delete(dedupKey);
    }
  };

  // Retry logic with exponential backoff
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const promise = doFetch();
      _pending.set(dedupKey, promise);
      const result = await promise;
      _pending.delete(dedupKey);
      return result;
    } catch (err) {
      lastError = err;
      _pending.delete(dedupKey);
      if (err.message === 'Request cancelled') {
        throw err;
      }
      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Search songs on NetEase (网易云).
 * @param {string} keywords
 * @param {number} [limit=20]
 * @param {number} [offset=0]
 * @param {AbortSignal} [signal]
 * @returns {Promise<any>}
 */
export function searchNetEase(keywords, limit = 20, offset = 0, signal) {
  const url = `/api/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}&offset=${offset}`;
  return apiFetch(url, {
    cacheKey: `search:netease:${keywords}:${limit}:${offset}`,
    cacheTTL: 60000,
    signal,
    retries: 1,
  });
}

/**
 * Search songs on Kuwo (酷我).
 * @param {string} keywords
 * @param {AbortSignal} [signal]
 * @returns {Promise<any>}
 */
export function searchKuwo(keywords, signal) {
  const url = `/api/search/kuwo?keywords=${encodeURIComponent(keywords)}`;
  return apiFetch(url, {
    cacheKey: `search:kuwo:${keywords}`,
    cacheTTL: 60000,
    signal,
    retries: 0, // Don't retry Kuwo (may have rate limits)
  });
}

import { weapi } from './netease-crypto.js';

/**
 * Get song URL from NetEase.
 * Browser-side weapi encryption: request originates from user's IP (not server).
 * Falls back to server-side API when browser fails (e.g., CORS).
 * @param {string|number} id
 * @param {number} [br=128000]
 * @param {string} [name=''] - Song name for server-side Kuwo fallback
 * @param {string} [artist=''] - Artist name for server-side Kuwo fallback
 * @returns {Promise<string|null>}
 */
export async function getSongUrl(id, br = 128000, name = '', artist = '') {
  const levelMap = { 128000: 'standard', 320000: 'exhigh', 999000: 'lossless' };

  // Primary: browser-side weapi encryption → direct call to music.163.com
  // Request originates from user's IP (likely China), not the overseas server.
  try {
    const { params, encSecKey } = await weapi({
      ids: `[${id}]`,
      level: levelMap[br] || 'standard',
      encodeType: 'aac',
    });
    const form = new URLSearchParams({ params, encSecKey }).toString();
    const resp = await fetch('https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://music.163.com/',
      },
      body: form,
    });
    const data = await resp.json();
    const item = (data.data || [])[0];
    if (item?.url) return item.url;
  } catch {
    // CORS blocked or failed → fall back to server-side
  }

  // Fallback 1: server-side API (overseas, may return null → Kuwo fallback with name+artist)
  try {
    const data = await apiFetch(`/api/song/url?id=${id}&br=${br}&name=${encodeURIComponent(name)}&artist=${encodeURIComponent(artist)}`, { retries: 1 });
    const item = (data.data || [])[0];
    if (item?.url) return item.url;
  } catch {
    // Server failed
  }

  // Fallback 2: browser weapi → server proxy to music.163.com
  try {
    const { params, encSecKey } = await weapi({
      ids: `[${id}]`,
      level: levelMap[br] || 'standard',
      encodeType: 'aac',
    });
    const data = await apiFetch('/api/netease/weapi', {
      method: 'POST',
      body: JSON.stringify({ path: '/song/enhance/player/url/v1', params, encSecKey }),
      headers: { 'Content-Type': 'application/json' },
      retries: 1,
    });
    const item = (data.data || [])[0];
    if (item?.url) return item.url;
  } catch {
    // All methods failed
  }
  return null;
}

/**
 * Get song details (for cover art).
 * @param {string} ids - Comma-separated song IDs
 * @returns {Promise<any>}
 */
export function getSongDetail(ids) {
  return apiFetch(`/api/song/detail?ids=${encodeURIComponent(ids)}`, {
    cacheKey: `detail:${ids}`,
    cacheTTL: 300000,
    retries: 1,
  });
}

/**
 * Get lyrics.
 * @param {string|number} id
 * @returns {Promise<any>}
 */
export function getLyric(id) {
  return apiFetch(`/api/lyric?id=${id}`, {
    cacheKey: `lyric:${id}`,
    cacheTTL: 86400000, // 24 hours - lyrics don't change
    retries: 1,
  });
}

/**
 * Get Kuwo song detail (cover + URL).
 * @param {string} msg - Search query (name + artist)
 * @param {number} [n=1] - Result index
 * @param {string} [size='128kmp3'] - Quality size
 * @returns {Promise<{url: string|null, cover: string}>}
 */
export async function getKuwoDetail(msg, n = 1, size = '128kmp3') {
  const data = await apiFetch(
    `/api/kuwo/detail?msg=${encodeURIComponent(msg)}&n=${n}&size=${encodeURIComponent(size)}`,
    { retries: 0 }
  );

  // Handle Kuwo API error (code can be string "400" or number 400)
  if (data.code == 400 || data.code === '400') {
    return { url: null, cover: '' };
  }

  const result = data?.data || {};
  return {
    url: result.vipmusic?.url || null,
    cover: result.picture || '',
  };
}

/**
 * Get Kuwo play URL by keywords.
 * @param {string} keywords
 * @param {string} [size='128kmp3']
 * @returns {Promise<string|null>}
 */
export async function getKuwoPlayUrl(keywords, size = '128kmp3') {
  const data = await apiFetch(
    `/api/song/url/kuwo?keywords=${encodeURIComponent(keywords)}&size=${encodeURIComponent(size)}`,
    { retries: 0 }
  );
  if (data.url) return data.url;

  // Fallback to netease
  const searchData = await searchNetEase(keywords, 5, 0);
  const songs = searchData.result?.songs || [];
  if (songs.length === 0) return null;
  return getSongUrl(String(songs[0].id));
}

/**
 * Search Bilibili MV.
 * @param {string} msg - Search query
 * @returns {Promise<{video_url: string, accept: string[], title: string, bvid: string}>}
 */
export async function searchBiliMV(msg) {
  const data = await apiFetch(`/api/bilibili?msg=${encodeURIComponent(msg)}&n=1`, {
    timeout: 20000,
    retries: 0,
  });
  if (data.code !== 200) throw new Error(data.msg || '搜索MV失败');

  const url = data.data?.url || '';
  const bvid = data.data?.bvid || (url.match(/BV[\w]+/) || [])[0];
  if (!bvid) throw new Error('未找到视频BV号');

  const mir6Data = await apiFetch(`/api/bilibili/mir6?bvid=${encodeURIComponent(bvid)}`, {
    timeout: 20000,
    retries: 0,
  });
  if (mir6Data.code !== 200) throw new Error(mir6Data.message || '视频解析失败');

  return {
    video_url: mir6Data.video_url,
    accept: mir6Data.accept || [],
    title: data.data?.title || '',
    bvid,
  };
}

/**
 * Get hot searches.
 * @returns {Promise<any[]>}
 */
export async function getHotSearches() {
  const data = await apiFetch('/api/search/hot', {
    cacheKey: 'hot-searches',
    cacheTTL: 3600000, // 1 hour
    retries: 0,
  });
  return data.data || [];
}

/**
 * Get playlist detail.
 * @param {string} id
 * @returns {Promise<any>}
 */
export function getPlaylistDetail(id) {
  return apiFetch(`/api/playlist/detail?id=${encodeURIComponent(id)}`, {
    cacheKey: `playlist-detail:${id}`,
    cacheTTL: 300000,
    retries: 1,
  });
}

/**
 * Get playlist tracks.
 * @param {string} id
 * @param {number} [limit=200]
 * @returns {Promise<any>}
 */
export function getPlaylistTracks(id, limit = 200) {
  return apiFetch(`/api/playlist/track/all?id=${encodeURIComponent(id)}&limit=${limit}`, {
    cacheKey: `playlist-tracks:${id}:${limit}`,
    cacheTTL: 300000,
    retries: 1,
  });
}

/**
 * Get artist songs.
 * @param {string} id
 * @param {number} [limit=50]
 * @returns {Promise<any>}
 */
export function getArtistSongs(id, limit = 50) {
  return apiFetch(`/api/artist/songs?id=${id}&limit=${limit}`, { retries: 1 });
}

/**
 * Health check.
 * @returns {Promise<{status: string, time: string}>}
 */
export function healthCheck() {
  return apiFetch('/api/health', { timeout: 5000, retries: 0 });
}

/**
 * Clear API cache (optionally by prefix).
 * @param {string} [prefix] - If set, only clear keys starting with this prefix
 */
export function clearCache(prefix) {
  if (prefix) {
    for (const [key] of _cache) {
      if (key.startsWith(prefix)) _cache.delete(key);
    }
  } else {
    _cache.clear();
  }
}

/**
 * Generate proxy URL for Kuwo audio.
 * @param {string} url
 * @returns {string}
 */
export function kuwoProxyUrl(url) {
  if (!url) return url;
  return `/api/kuwo/audio?url=${encodeURIComponent(url)}`;
}

/**
 * Generate proxy URL for NetEase audio.
 * @param {string} url
 * @returns {string}
 */
export function neteaseProxyUrl(url) {
  if (!url) return url;
  return `/api/netease/audio?url=${encodeURIComponent(url)}`;
}
