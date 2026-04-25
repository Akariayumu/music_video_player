/**
 * @file Music Player App — refactored with modular architecture,
 *       unified API client, AbortController-based cancellation,
 *       debounced search, localStorage persistence, and JSDoc types.
 */

import {
  searchNetEase, searchKuwo, getSongUrl, getSongDetail,
  getLyric, getKuwoDetail, getKuwoPlayUrl, searchBiliMV,
  getHotSearches, getPlaylistDetail, getPlaylistTracks,
  cancelRequests, cancelRequest, kuwoProxyUrl, neteaseProxyUrl,
} from './api.js';

import {
  loadSettings, saveVolume, saveShuffle, saveRepeat, saveQuality,
} from './storage.js';

/* ===== Helpers ===== */

/** @type {(id: string) => HTMLElement} */
const $ = id => document.getElementById(id);

/**
 * Format seconds to m:ss.
 * @param {number} s
 * @returns {string}
 */
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Escape HTML.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {boolean} [isError=false]
 */
function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ===== Quality Mappings ===== */

const QUALITY_BR = { standard: 128000, exhigh: 320000, SQ: 999000, lossless: 999000, hires: 999000 };
const QUALITY_KUWO_SIZE = { standard: '128kmp3', exhigh: '320kmp3', SQ: '2000kflac', lossless: '2000kflac', hires: 'hires' };
const QUALITY_LABEL = { standard: '标准', exhigh: '极高', SQ: '超品', lossless: '无损', hires: 'Hi-Res' };

/* ===== State ===== */

/**
 * @typedef {Object} Track
 * @property {string} id
 * @property {string} name
 * @property {string} artist
 * @property {string} album
 * @property {string} cover
 * @property {number} duration
 * @property {'local'|'online'} type
 * @property {'netease'|'kuwo'|''} [source]
 * @property {string|null} [url]
 * @property {string} [_dedupKey]
 */

/**
 * @typedef {Object} PlayerState
 * @property {Track[]} playlist
 * @property {number} currentIndex
 * @property {boolean} isPlaying
 * @property {boolean} shuffle
 * @property {'none'|'all'|'one'} repeat
 * @property {number} volume
 * @property {boolean} muted
 * @property {boolean} seeking
 * @property {boolean} volumeDragging
 * @property {Track|null} [contextTarget]
 * @property {number} [contextIndex]
 * @property {{time: number, text: string}[]} lyrics
 * @property {boolean} lyricsVisible
 * @property {string} quality
 * @property {boolean} mvMode
 * @property {boolean} loading — track is loading (blocks rapid switching)
 * @property {number} _loadVersion — monotonic counter to detect stale callbacks
 */

/** @type {PlayerState} */
const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeat: 'none',
  volume: 0.8,
  muted: false,
  seeking: false,
  volumeDragging: false,
  contextTarget: null,
  contextIndex: -1,
  lyrics: [],
  lyricsVisible: false,
  quality: 'standard',
  mvMode: false,
  loading: false,
  _loadVersion: 0,
};

/* ===== Audio ===== */

const audio = $('audioPlayer');
audio.crossOrigin = 'anonymous';

/** @type {AudioContext|null} */
let audioCtx = null;
/** @type {AnalyserNode|null} */
let analyser = null;
/** @type {MediaElementAudioSourceNode|null} */
let source = null;
/** @type {number} */
let animFrame = null;

/** @type {AbortController|null} — current track loading abort controller */
let currentLoadController = null;

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

/* ===== Canvas Visualizer ===== */

const canvas = $('visualizer');
const ctx2d = canvas.getContext('2d');

function drawVisualizer() {
  animFrame = requestAnimationFrame(drawVisualizer);
  if (!analyser) { ctx2d.clearRect(0, 0, canvas.width, canvas.height); return; }

  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);

  const w = canvas.width, h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);

  const bars = buf.length;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.37;

  // Create a single radial gradient for all bars
  const grad = ctx2d.createRadialGradient(cx, cy, r, cx, cy, r * 1.5);
  grad.addColorStop(0, 'rgba(124,106,247,0.7)');
  grad.addColorStop(0.5, 'rgba(180,120,200,0.5)');
  grad.addColorStop(1, 'rgba(233,109,176,0.3)');

  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const amp = (buf[i] / 255) * r * 0.55;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle) * (r + amp);
    const y2 = cy + Math.sin(angle) * (r + amp);

    ctx2d.strokeStyle = grad;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(x1, y1);
    ctx2d.lineTo(x2, y2);
    ctx2d.stroke();
  }
}

function resizeCanvas() {
  const c = canvas.parentElement;
  canvas.width = c.offsetWidth * 1.3;
  canvas.height = c.offsetHeight * 1.3;
}

/* ===== Playlist Management ===== */

/**
 * Add a track to the playlist.
 * @param {Track} track
 * @param {'end'|'next'} [position='end']
 * @returns {number} index of added track, or existing index if duplicate
 */
function addTrack(track, position = 'end') {
  const dup = state.playlist.findIndex(t => t.id && t.id === track.id);
  if (dup !== -1 && track.id) { toast('已在列表中'); return dup; }

  if (position === 'end') {
    state.playlist.push(track);
    renderPlaylist();
    return state.playlist.length - 1;
  } else {
    const after = state.currentIndex + 1;
    state.playlist.splice(after, 0, track);
    if (state.currentIndex >= after) state.currentIndex++;
    renderPlaylist();
    return after;
  }
}

/**
 * Remove a track by index.
 * @param {number} index
 */
function removeTrack(index) {
  if (index === state.currentIndex) {
    const wasPlaying = state.isPlaying;
    audio.pause();
    state.playlist.splice(index, 1);
    if (state.playlist.length === 0) {
      state.currentIndex = -1;
      resetPlayer();
    } else {
      state.currentIndex = Math.min(index, state.playlist.length - 1);
      loadTrack(state.currentIndex);
      if (wasPlaying) audio.play().catch(() => { });
    }
  } else {
    state.playlist.splice(index, 1);
    if (index < state.currentIndex) state.currentIndex--;
  }
  renderPlaylist();
}

/** Render the playlist UI from state. */
function renderPlaylist() {
  const list = $('playlist');
  const empty = $('playlistEmpty');

  if (state.playlist.length === 0) {
    empty.style.display = 'flex';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  const fragment = document.createDocumentFragment();
  state.playlist.forEach((t, i) => {
    const active = i === state.currentIndex;
    const li = document.createElement('li');
    li.className = `playlist-item ${active ? 'active' : ''}`;
    li.dataset.index = i;

    const thumb = t.cover
      ? `<img src="${t.cover}" class="track-thumb" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">`
      : '';
    const placeholder = `<div class="track-thumb-placeholder" ${t.cover ? 'style="display:none"' : ''}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
        <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="2"/>
      </svg>
    </div>`;
    const dur = t.duration ? fmtTime(t.duration / 1000) : '';
    li.innerHTML = `
      <div class="track-index">${i + 1}</div>
      <div class="track-playing">
        <div class="bar" style="height:8px"></div>
        <div class="bar" style="height:12px"></div>
        <div class="bar" style="height:6px"></div>
      </div>
      ${thumb}${placeholder}
      <div class="track-info">
        <div class="track-name">${esc(t.name)}</div>
        <div class="track-artist">${esc(t.artist || '')}</div>
      </div>
      ${dur ? `<span class="track-duration">${dur}</span>` : ''}
      <button class="track-remove" data-remove="${i}" title="移除" aria-label="移除 ${esc(t.name)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>`;

    fragment.appendChild(li);
  });

  // Replace all children at once (reduces reflow)
  list.innerHTML = '';
  list.appendChild(fragment);

  const activeEl = list.querySelector('.playlist-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

/* ===== Marquee ===== */

function applyMarquee(el) {
  el.classList.remove('text-scrolling');
  el.style.removeProperty('--scroll-dist');
  requestAnimationFrame(() => {
    const overflow = el.scrollWidth - el.parentElement.clientWidth;
    if (overflow > 8) {
      el.style.setProperty('--scroll-dist', `-${overflow}px`);
      el.classList.add('text-scrolling');
    }
  });
}

/* ===== Track Loading (State Machine) ===== */

/**
 * Load a track by index. Uses a version counter to prevent stale callbacks
 * and AbortController to cancel in-flight API requests.
 * @param {number} index
 */
function loadTrack(index) {
  if (index < 0 || index >= state.playlist.length) return;

  // Bump version to invalidate any previous loadTrack's callbacks
  state._loadVersion++;
  const myVersion = state._loadVersion;

  // Cancel previous in-flight requests
  if (currentLoadController) {
    currentLoadController.abort();
  }
  currentLoadController = new AbortController();
  const signal = currentLoadController.signal;

  const wasInMVMode = state.mvMode;
  hideMVPlayer();

  state.loading = true;
  state.currentIndex = index;
  const track = state.playlist[index];

  // Update UI immediately
  $('songTitle').textContent = track.name;
  $('currentSongTitle').textContent = track.name + (track.artist ? ' - ' + track.artist : '');
  $('lyricsSongTitle').textContent = track.name;
  $('lyricsSongArtist').textContent = track.artist || '';
  applyMarquee($('songTitle'));
  applyMarquee($('currentSongTitle'));

  if (track.cover) {
    const img = $('coverArt');
    img.src = track.cover;
    img.onload = () => {
      img.classList.add('loaded');
      $('coverPlaceholder').classList.add('hidden');
    };
    img.onerror = () => {
      img.classList.remove('loaded');
      $('coverPlaceholder').classList.remove('hidden');
    };
  } else {
    $('coverArt').classList.remove('loaded');
    $('coverPlaceholder').classList.remove('hidden');
  }

  renderPlaylist();
  document.title = `${track.name} - Music Player`;

  // Handle track loading based on type
  if (track.type === 'online') {
    if (!track.url) {
      _fetchAndPlay(track, signal, myVersion);
    } else {
      // Already has URL, just set it
      _setSourceAndPlay(track, myVersion);
    }

    // Load lyrics for netease tracks
    if (track.source === 'netease') {
      loadLyrics(track.id);
    } else {
      clearLyrics();
    }
  } else {
    // Local file
    if (track.url) {
      audio.src = track.url;
    }
    clearLyrics();
    state.loading = false;
  }

  // Auto-load MV if previous track was in video mode
  if (wasInMVMode) {
    const cached = getMVCache(track.name, track.artist || '');
    if (cached && cached.videoUrl) {
      setTimeout(() => openMVPanel(), 100);
    }
  }
}

/**
 * Fetch play URL for a track and set the audio source.
 * @param {Track} track
 * @param {AbortSignal} signal
 * @param {number} version
 */
async function _fetchAndPlay(track, signal, version) {
  try {
    if (track.source === 'kuwo') {
      const msg = track.artist ? `${track.name} ${track.artist}` : track.name;
      const size = QUALITY_KUWO_SIZE[state.quality] || '128kmp3';
      const result = await getKuwoDetail(msg, 1, size);

      // Check if we're still on the same track
      if (state._loadVersion !== version || signal.aborted) return;

      if (result.cover && !track.cover) {
        track.cover = result.cover;
        const img = $('coverArt');
        img.src = result.cover;
        img.onload = () => { img.classList.add('loaded'); $('coverPlaceholder').classList.add('hidden'); };
      }

      if (result.url) {
        track.url = result.url;
        _setSourceAndPlay(track, version);
      } else {
        _handlePlayError(track, version, '该歌曲暂不可用');
      }
    } else {
      // NetEase source
      const br = QUALITY_BR[state.quality] || 128000;
      const url = await getSongUrl(track.id, br);

      if (state._loadVersion !== version || signal.aborted) return;

      if (url) {
        track.url = url;
        _setSourceAndPlay(track, version);
      } else {
        _handlePlayError(track, version, '无法获取播放链接');
      }
    }
  } catch (err) {
    if (err.message === 'Request cancelled') return;
    if (state._loadVersion !== version) return;
    _handlePlayError(track, version, `获取播放链接失败: ${err.message}`);
  }
}

/**
 * Set audio source and auto-play.
 * @param {Track} track
 * @param {number} version
 */
function _setSourceAndPlay(track, version) {
  if (state._loadVersion !== version) return;

  audio.src = track.url;
  // Delay auto-play 500ms for cover animation
  setTimeout(() => {
    if (state._loadVersion !== version) return;
    audio.play()
      .then(() => setPlaying(true))
      .catch(() => { /* autoplay blocked or source error */ });
  }, 500);

  state.loading = false;
}

/**
 * Handle playback errors with unified strategy.
 * @param {Track} track
 * @param {number} version
 * @param {string} message
 */
function _handlePlayError(track, version, message) {
  if (state._loadVersion !== version) return;
  state.loading = false;
  toast(message, true);
}

/**
 * Play a track by index.
 * @param {number} index
 */
function playTrack(index) {
  loadTrack(index);
  // loadTrack will auto-play after URL fetch
  // If it's a local track or already has URL, we need to explicitly play
  const track = state.playlist[index];
  if (track && (track.type !== 'online' || track.url)) {
    setTimeout(() => audio.play().then(() => setPlaying(true)).catch(() => { }), 100);
  }
}

/** Toggle play/pause. */
function togglePlay() {
  if (state.playlist.length === 0) return;
  if (state.currentIndex === -1) { playTrack(0); return; }
  if (audio.paused) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    audio.play().then(() => setPlaying(true)).catch(() => { });
  } else {
    audio.pause();
    setPlaying(false);
  }
}

/**
 * Set playing state and update UI.
 * @param {boolean} val
 */
function setPlaying(val) {
  state.isPlaying = val;
  const playBtn = $('playBtn');
  playBtn.querySelector('.icon-play').classList.toggle('hidden', val);
  playBtn.querySelector('.icon-pause').classList.toggle('hidden', !val);
  if (!state.mvMode) {
    $('coverWrapper').parentElement.classList.toggle('playing', val);
  }
}

/** Reset player to idle state. */
function resetPlayer() {
  state.isPlaying = false;
  audio.src = '';
  $('songTitle').textContent = 'Music Player';
  $('currentSongTitle').textContent = '未在播放';
  [$('songTitle'), $('currentSongTitle')].forEach(el => {
    el.classList.remove('text-scrolling');
    el.style.removeProperty('--scroll-dist');
  });
  $('coverArt').classList.remove('loaded');
  $('coverPlaceholder').classList.remove('hidden');
  $('progressFill').style.width = '0%';
  $('progressThumb').style.left = '0%';
  $('timeCurrent').textContent = '0:00';
  $('timeTotal').textContent = '0:00';
  setPlaying(false);
  document.title = 'Music Player';
}

/** Play next track. */
function playNext() {
  if (state.playlist.length === 0) return;
  const next = _nextIndex();
  playTrack(next);
}

/** Play previous track. */
function playPrev() {
  if (state.playlist.length === 0) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prev = state.currentIndex - 1;
  if (prev < 0) prev = state.playlist.length - 1;
  playTrack(prev);
}

/**
 * Calculate the next track index based on shuffle/repeat mode.
 * @returns {number}
 */
function _nextIndex() {
  if (state.shuffle) return Math.floor(Math.random() * state.playlist.length);
  let next = state.currentIndex + 1;
  if (next >= state.playlist.length) next = 0;
  return next;
}

/* ===== Audio Events ===== */

audio.addEventListener('timeupdate', () => {
  if (state.seeking || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  $('progressFill').style.width = pct + '%';
  $('progressThumb').style.left = pct + '%';
  $('timeCurrent').textContent = fmtTime(audio.currentTime);
  updateActiveLyric(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  $('timeTotal').textContent = fmtTime(audio.duration);
});

audio.addEventListener('ended', () => {
  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play();
  } else if (state.repeat === 'all' || state.playlist.length > 1) {
    playNext();
  } else {
    setPlaying(false);
  }
});

audio.addEventListener('play', () => {
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  setPlaying(true);
  if (!animFrame) drawVisualizer();
});

audio.addEventListener('pause', () => {
  setPlaying(false);
});

audio.addEventListener('error', () => {
  const track = state.playlist[state.currentIndex];
  if (!audio.src || audio.src === window.location.href) return;
  if (!track) return;

  // Handle proxy retry
  if (track.url && !track._proxyAttempted) {
    track._proxyAttempted = true;
    let proxyUrl = null;
    if (track.source === 'netease') {
      proxyUrl = neteaseProxyUrl(track.url);
    } else if (track.source === 'kuwo') {
      proxyUrl = kuwoProxyUrl(track.url);
    }
    if (proxyUrl && track.url !== proxyUrl) {
      const wasPlaying = state.isPlaying;
      audio.src = proxyUrl;
      audio.load();
      if (wasPlaying) {
        setTimeout(() => audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)), 300);
      }
      toast('直接播放失败，已通过服务器中转', true);
      return;
    }
  }

  // Handle kuwo→netease fallback
  if (track.source === 'kuwo' && !track._fallbackAttempted) {
    track._fallbackAttempted = true;
    toast('酷我音源不可用，尝试切换到网易云…', true);
    const keywords = `${track.name} ${track.artist}`;
    searchNetEase(keywords, 1)
      .then(data => {
        const songs = data.result?.songs || [];
        if (songs.length > 0 && state.currentIndex >= 0 && state.playlist[state.currentIndex] === track) {
          const s = songs[0];
          track.id = String(s.id);
          track.source = 'netease';
          track.url = null;
          track._fallbackAttempted = false;
          loadTrack(state.currentIndex);
        } else {
          toast('网易云也无此歌曲', true);
          setPlaying(false);
        }
      })
      .catch(() => {
        toast('切换音源失败', true);
        setPlaying(false);
      });
    return;
  }

  setPlaying(false);
  toast('播放失败，该歌曲暂不可用', true);
});

/* ===== Progress Bar Drag ===== */

function setupProgressDrag() {
  const container = $('progressContainer');

  function setFromEvent(e) {
    const rect = container.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    if (audio.duration) {
      audio.currentTime = pct * audio.duration;
      $('progressFill').style.width = (pct * 100) + '%';
      $('progressThumb').style.left = (pct * 100) + '%';
      $('timeCurrent').textContent = fmtTime(audio.currentTime);
    }
  }

  container.addEventListener('mousedown', e => {
    state.seeking = true;
    setFromEvent(e);
    const up = () => { state.seeking = false; document.removeEventListener('mouseup', up); document.removeEventListener('mousemove', move); };
    const move = e2 => setFromEvent(e2);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  container.addEventListener('touchstart', e => { state.seeking = true; setFromEvent(e); }, { passive: true });
  container.addEventListener('touchmove', e => setFromEvent(e), { passive: true });
  container.addEventListener('touchend', () => { state.seeking = false; });
}

/* ===== Volume Drag ===== */

function setupVolumeDrag() {
  const container = $('volumeContainer');

  function setFromEvent(e) {
    const rect = container.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setVolume(pct);
  }

  container.addEventListener('mousedown', e => {
    state.volumeDragging = true;
    setFromEvent(e);
    const up = () => { state.volumeDragging = false; document.removeEventListener('mouseup', up); document.removeEventListener('mousemove', move); };
    const move = e2 => setFromEvent(e2);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  container.addEventListener('touchstart', e => setFromEvent(e), { passive: true });
  container.addEventListener('touchmove', e => setFromEvent(e), { passive: true });
}

/**
 * Set volume level.
 * @param {number} val 0-1
 */
function setVolume(val) {
  state.volume = val;
  state.muted = false;
  audio.volume = val;
  audio.muted = false;
  const pct = (val * 100) + '%';
  $('volumeFill').style.width = pct;
  $('volumeThumb').style.left = pct;
  $('volumeValue').textContent = Math.round(val * 100);
  $('muteBtn').querySelector('.icon-volume').classList.remove('hidden');
  $('muteBtn').querySelector('.icon-mute').classList.add('hidden');
  saveVolume(val);
}

/** Toggle mute. */
function toggleMute() {
  state.muted = !state.muted;
  audio.muted = state.muted;
  $('muteBtn').querySelector('.icon-volume').classList.toggle('hidden', state.muted);
  $('muteBtn').querySelector('.icon-mute').classList.toggle('hidden', !state.muted);
}

/* ===== Shuffle & Repeat ===== */

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  $('shuffleBtn').classList.toggle('active', state.shuffle);
  toast(state.shuffle ? '随机播放 开' : '随机播放 关');
  saveShuffle(state.shuffle);
}

function toggleRepeat() {
  const modes = ['none', 'all', 'one'];
  const idx = modes.indexOf(state.repeat);
  state.repeat = modes[(idx + 1) % modes.length];
  const btn = $('repeatBtn');
  btn.classList.toggle('active', state.repeat !== 'none');
  btn.querySelector('.icon-repeat').classList.toggle('hidden', state.repeat === 'one');
  btn.querySelector('.icon-repeat-one').classList.toggle('hidden', state.repeat !== 'one');
  const labels = { none: '不循环', all: '列表循环', one: '单曲循环' };
  toast(labels[state.repeat]);
  saveRepeat(state.repeat);
}

/* ===== Online Search (with debounce) ===== */

/** @type {number} — debounce timer ID */
let _searchDebounceTimer = 0;

/**
 * Debounced search trigger.
 * @param {string} keywords
 */
function triggerSearch(keywords) {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(() => searchSongs(keywords), 400);
}

/**
 * Search songs from both APIs concurrently.
 * @param {string} keywords
 * @param {number} [offset=0]
 */
async function searchSongs(keywords, offset = 0) {
  // Cancel any in-flight search requests
  cancelRequests('search:');

  const results = $('searchResults');
  if (offset === 0) results.innerHTML = '<p class="loading-text searching">搜索中…</p>';

  try {
    const [neteaseResult, kuwoResult] = await Promise.allSettled([
      searchNetEase(keywords, 20, offset),
      offset === 0 ? searchKuwo(keywords) : Promise.resolve(null),
    ]);

    const neteaseSongs = neteaseResult.status === 'fulfilled' ? (neteaseResult.value?.result?.songs || []) : [];
    const kuwoSongs = kuwoResult.status === 'fulfilled' && kuwoResult.value ? (kuwoResult.value?.data?.songs || []) : [];

    if (offset === 0) results.innerHTML = '';

    // Fetch cover art for netease songs
    let coverMap = {};
    if (neteaseSongs.length > 0) {
      try {
        const songIds = neteaseSongs.map(s => s.id).join(',');
        const detailRes = await getSongDetail(songIds);
        (detailRes.songs || []).forEach(s => {
          const pic = s.al?.picUrl || '';
          if (pic) coverMap[s.id] = pic;
        });
      } catch (e) { console.warn('Failed to fetch covers:', e); }
    }

    // Build netease track objects
    const neteaseTracks = neteaseSongs.map(song => {
      const artists = (song.artists || song.ar || []).map(a => a.name).join(' / ');
      const album = song.album?.name || song.al?.name || '';
      const cover = coverMap[song.id] || song.album?.picUrl || song.al?.picUrl || '';
      const dur = song.duration || song.dt || 0;
      return {
        id: String(song.id), name: song.name, artist: artists, album,
        cover: cover ? cover + '?param=300y300' : '',
        duration: dur, type: 'online', source: 'netease', url: null,
        _dedupKey: (song.name + '|' + artists).toLowerCase()
      };
    });

    // Build kuwo track objects, dedup against netease
    const seenKeys = new Set(neteaseTracks.map(t => t._dedupKey));
    const kuwoTracks = kuwoSongs
      .filter(song => {
        const key = (song.name + '|' + (song.singer || '')).toLowerCase();
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .map(song => ({
        id: `kuwo_${song.name}_${song.singer || ''}`,
        name: song.name, artist: song.singer || '', album: song.album || '',
        cover: '', duration: 0, type: 'online', source: 'kuwo', url: null,
        _dedupKey: (song.name + '|' + (song.singer || '')).toLowerCase()
      }));

    // Merge: kuwo first (no IP restriction), then netease
    const merged = [...kuwoTracks, ...neteaseTracks];

    if (merged.length === 0 && offset === 0) {
      results.innerHTML = '<p class="loading-text">无结果</p>';
      return;
    }

    merged.forEach(track => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.style.animationDelay = `${results.children.length * 0.04}s`;
      const sourceTag = track.source === 'kuwo'
        ? '<span class="source-tag kuwo-tag">酷我</span>'
        : '<span class="source-tag netease-tag">网易</span>';
      item.innerHTML = `
        <div class="result-info">
          <div class="result-name">${esc(track.name)} ${sourceTag}</div>
          <div class="result-meta">${esc(track.artist)}${track.album ? ' · ' + esc(track.album) : ''}</div>
        </div>
        <button class="result-add" title="添加到列表" aria-label="添加 ${esc(track.name)} 到列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>`;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.result-add')) {
          addTrack(track);
          toast(`已添加: ${track.name}`);
        } else {
          const idx = addTrack(track);
          playTrack(typeof idx === 'number' ? idx : state.playlist.length - 1);
          showPanel('playlist');
        }
      });

      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        state.contextTarget = track;
        state.contextIndex = -1;
        showContextMenu(e.clientX, e.clientY, true);
      });

      results.appendChild(item);
    });

  } catch (err) {
    if (err.message === 'Request cancelled') return;
    results.innerHTML = '<p class="loading-text">搜索失败，请确认服务已启动</p>';
  }
}

/**
 * Fetch Kuwo detail with quality fallback.
 * @param {string} name
 * @param {string} artist
 * @returns {Promise<{url: string|null, cover: string}>}
 */
async function fetchKuwoDetailWithFallback(name, artist) {
  const QUALITY_ORDER = ['hires', 'lossless', 'SQ', 'exhigh', 'standard'];
  const startIdx = QUALITY_ORDER.indexOf(state.quality);
  const qualitiesToTry = QUALITY_ORDER.slice(startIdx >= 0 ? startIdx : 0);

  for (const quality of qualitiesToTry) {
    const size = QUALITY_KUWO_SIZE[quality] || '128kmp3';
    const msg = artist ? `${name} ${artist}` : name;
    const result = await getKuwoDetail(msg, 1, size);
    if (result.url) {
      if (quality !== state.quality) {
        toast(`${QUALITY_LABEL[state.quality]} 不可用，已降级至 ${QUALITY_LABEL[quality]}`);
      }
      return result;
    }
  }
  return { url: null, cover: '' };
}

/**
 * Fetch Kuwo play URL with netease fallback.
 * @param {string} name
 * @param {string} artist
 * @returns {Promise<string|null>}
 */
async function fetchKuwoPlayUrl(name, artist) {
  const keywords = artist ? `${name} ${artist}` : name;
  const size = QUALITY_KUWO_SIZE[state.quality] || '128kmp3';
  return getKuwoPlayUrl(keywords, size);
}

/** Load and display hot searches. */
async function loadHotSearches() {
  try {
    const list = await getHotSearches();
    const container = $('hotTags');
    if (list.length === 0) { $('hotSearches').style.display = 'none'; return; }
    container.innerHTML = list.slice(0, 10).map(item =>
      `<span class="hot-tag" role="button" tabindex="0" aria-label="搜索 ${esc(item.searchWord || item.first || '')}">${esc(item.searchWord || item.first || '')}</span>`
    ).join('');
    container.querySelectorAll('.hot-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        $('searchInput').value = tag.textContent;
        searchSongs(tag.textContent);
      });
      tag.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          $('searchInput').value = tag.textContent;
          searchSongs(tag.textContent);
        }
      });
    });
  } catch {
    $('hotSearches').style.display = 'none';
  }
}

/* ===== Lyrics ===== */

/**
 * Load and render lyrics for a song.
 * @param {string|number} id
 */
async function loadLyrics(id) {
  clearLyrics();
  try {
    const data = await getLyric(id);
    const lrc = data.lrc?.lyric || '';
    state.lyrics = parseLrc(lrc);
    if (state.lyrics.length > 0) renderLyrics();
    else $('lyricsContent').innerHTML = '<p class="lyrics-placeholder">暂无歌词</p>';
  } catch {
    $('lyricsContent').innerHTML = '<p class="lyrics-placeholder">歌词加载失败</p>';
  }
}

/**
 * Parse LRC format lyrics.
 * @param {string} lrc
 * @returns {{time: number, text: string}[]}
 */
function parseLrc(lrc) {
  const lines = [];
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
  let m;
  while ((m = re.exec(lrc)) !== null) {
    const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3].padEnd(3, '0')) / 1000;
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function renderLyrics() {
  $('lyricsContent').innerHTML = state.lyrics.map((l, i) =>
    `<div class="lyric-line" data-index="${i}" data-time="${l.time}" role="button" tabindex="0" aria-label="跳转到 ${fmtTime(l.time)}">${esc(l.text)}</div>`
  ).join('');

  $('lyricsContent').querySelectorAll('.lyric-line').forEach(el => {
    el.addEventListener('click', () => {
      audio.currentTime = parseFloat(el.dataset.time);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        audio.currentTime = parseFloat(el.dataset.time);
      }
    });
  });
}

function clearLyrics() {
  state.lyrics = [];
  $('lyricsContent').innerHTML = '<p class="lyrics-placeholder">暂无歌词</p>';
  $('currentLyric').textContent = '暂无歌词';
}

let lastLyricIndex = -1;

/**
 * Update active lyric line based on current playback time.
 * @param {number} time
 */
function updateActiveLyric(time) {
  if (state.lyrics.length === 0) return;
  let idx = state.lyrics.findLastIndex(l => l.time <= time);
  if (idx === lastLyricIndex) return;
  lastLyricIndex = idx;

  const lines = $('lyricsContent').querySelectorAll('.lyric-line');
  lines.forEach((el, i) => el.classList.toggle('active', i === idx));
  if (idx >= 0 && state.lyricsVisible) {
    lines[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Update inline lyric below cover
  const lyricEl = $('currentLyric');
  if (idx >= 0 && state.lyrics[idx]) {
    const curText = state.lyrics[idx].text;
    const nextText = (idx + 1 < state.lyrics.length) ? state.lyrics[idx + 1].text : '';
    lyricEl.innerHTML = `<span class="lyric-cur">${curText}</span>${nextText ? `<span class="lyric-next">${nextText}</span>` : ''}`;
    lyricEl.classList.add('has-lyric');
  } else {
    lyricEl.innerHTML = '<span class="lyric-cur">暂无歌词</span>';
    lyricEl.classList.remove('has-lyric');
  }
}

/* ===== Local Files ===== */

/**
 * Handle uploaded audio files.
 * @param {FileList} files
 */
function handleFiles(files) {
  const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/') || /\.(mp3|flac|ogg|aac|wav|m4a|opus)$/i.test(f.name));
  if (audioFiles.length === 0) { toast('没有找到支持的音频文件', true); return; }

  audioFiles.forEach(file => {
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    const track = { id: url, name, artist: '', album: '', cover: '', duration: 0, type: 'local', url };
    addTrack(track);
  });

  toast(`已添加 ${audioFiles.length} 首歌曲`);
  showPanel('playlist');
}

/* ===== Context Menu ===== */

/**
 * Show context menu.
 * @param {number} x
 * @param {number} y
 * @param {boolean} [isSearch=false]
 */
function showContextMenu(x, y, isSearch = false) {
  const menu = $('contextMenu');
  $('ctxRemove').style.display = isSearch ? 'none' : 'flex';
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

function hideContextMenu() { $('contextMenu').classList.add('hidden'); }

/* ===== Sidebar & Panels ===== */

function toggleSidebar() {
  const sb = $('sidebar');
  const backdrop = $('sidebarBackdrop');
  if (window.innerWidth <= 767) {
    const isOpen = sb.classList.contains('open');
    if (isOpen) {
      sb.classList.remove('open');
      backdrop.classList.remove('active');
    } else {
      sb.classList.add('open');
      backdrop.classList.add('active');
    }
  } else {
    sb.classList.toggle('collapsed');
  }
}

function openSidebarPanel(name) {
  showPanel(name);
  if (window.innerWidth <= 767) {
    $('sidebar').classList.add('open');
    $('sidebarBackdrop').classList.add('active');
  }
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  $(`panel-${name}`).classList.add('active');
  const navBtn = document.querySelector(`.nav-item[data-panel="${name}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelectorAll('.bottom-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
}

/* ===== Touch Gestures ===== */

function setupTouchGestures() {
  let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
  const area = document.querySelector('.main-content');

  area.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  area.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dt = Date.now() - touchStartTime;
    if (dt < 500 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (e.target.closest('#coverContainer')) return;
      if (dx < 0) playNext();
      else playPrev();
    }
  }, { passive: true });
}

/* ===== Long Press on Cover ===== */

function setupCoverLongPress() {
  let longPressTimer = null;
  const cover = $('coverContainer');

  cover.addEventListener('touchstart', () => {
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      const track = state.playlist[state.currentIndex];
      if (!track) return;
      state.contextTarget = track;
      state.contextIndex = state.currentIndex;
      const rect = cover.getBoundingClientRect();
      showContextMenu(rect.left + rect.width / 2 - 80, rect.bottom - 20, false);
    }, 600);
  }, { passive: true });

  cover.addEventListener('touchend', () => { clearTimeout(longPressTimer); }, { passive: true });
  cover.addEventListener('touchmove', () => { clearTimeout(longPressTimer); }, { passive: true });
}

/* ===== Quality ===== */

/**
 * Set audio quality and reload current track.
 * @param {string} quality
 */
function setQuality(quality) {
  state.quality = quality;
  $('qualityLabel').textContent = QUALITY_LABEL[quality] || quality;
  document.querySelectorAll('.quality-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quality === quality);
  });
  $('qualityDropdown').classList.add('hidden');
  saveQuality(quality);

  const track = state.playlist[state.currentIndex];
  if (track && track.type === 'online') {
    // Cancel current load and reload with new quality
    state._loadVersion++;
    if (currentLoadController) currentLoadController.abort();
    const currentTime = audio.currentTime;
    track.url = null;
    track._proxyAttempted = false;

    if (track.source === 'kuwo') {
      fetchKuwoPlayUrl(track.name, track.artist).then(url => {
        if (url) {
          track.url = url;
          audio.src = url;
          audio.currentTime = currentTime;
          if (state.isPlaying) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          toast('该音质暂不可用', true);
        }
      });
    } else {
      getSongUrl(track.id, QUALITY_BR[quality] || 128000).then(url => {
        if (url) {
          track.url = url;
          audio.src = url;
          audio.currentTime = currentTime;
          if (state.isPlaying) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          toast('该音质暂不可用', true);
        }
      });
    }
  }

  toast(`音质: ${QUALITY_LABEL[quality]}`);
}

/* ===== Bilibili MV ===== */

/**
 * Clean song name for MV search (remove brackets, feat, etc.).
 * @param {string} name
 * @returns {string}
 */
function cleanSongName(name) {
  return name
    .replace(/[\(\[\{（【].*?[\)\]\}）】]/g, '')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/\s+with\s+.+$/i, '')
    .replace(/\s+&\s+.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch Bilibili MV for a song.
 * @param {string} name
 * @param {string} artist
 * @returns {Promise<{video_url: string, accept: string[], title: string, bvid: string}>}
 */
async function fetchBiliMV(name, artist) {
  const cleanName = cleanSongName(name).slice(0, 30);
  const cleanArtist = artist ? artist.replace(/[\(\[\{（【].*?[\)\]\}）】]/g, '').trim() : '';
  const query = cleanArtist
    ? encodeURIComponent(`${cleanName} ${cleanArtist} MV`)
    : encodeURIComponent(`${cleanName} MV`);

  return searchBiliMV(query);
}

/* ===== MV Cache ===== */

function mvCacheKey(name, artist) {
  return `mv_cache:${name}||${artist || ''}`;
}

function getMVCache(name, artist) {
  try {
    const raw = localStorage.getItem(mvCacheKey(name, artist));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setMVCache(name, artist, data) {
  try {
    localStorage.setItem(mvCacheKey(name, artist), JSON.stringify({
      videoUrl: data.video_url,
      accept: data.accept || [],
      bvid: data.bvid || '',
      title: data.title || name,
      lastPosition: 0
    }));
  } catch { }
}

function saveMVPosition(name, artist, position) {
  try {
    const key = mvCacheKey(name, artist);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const cached = JSON.parse(raw);
    cached.lastPosition = position;
    localStorage.setItem(key, JSON.stringify(cached));
  } catch { }
}

/* ===== Inline MV Panel ===== */

function showInlineMV(videoUrl, accept, title, lastPosition) {
  const panel = $('mvFullPanel');
  const inner = $('mvFullInner');

  let qualityHtml = '';
  if (Array.isArray(accept) && accept.length > 1) {
    const btns = accept.map((q, i) => {
      const label = typeof q === 'string' ? q : (q.description || q.name || q.quality || `画质${i + 1}`);
      const qurl = typeof q === 'object' ? (q.url || q.video_url || '') : '';
      return `<button class="mv-quality-btn ${i === 0 ? 'active' : ''}" data-url="${esc(qurl)}" data-index="${i}">${esc(String(label))}</button>`;
    }).join('');
    qualityHtml = `<div class="mv-quality-bar">${btns}</div>`;
  }

  inner.innerHTML = `
    ${qualityHtml}
    <video id="inlineMVVideo" src="${esc(videoUrl)}" controls playsinline></video>
  `;

  const vid = $('inlineMVVideo');
  if (lastPosition > 0) {
    vid.addEventListener('loadedmetadata', () => { vid.currentTime = lastPosition; }, { once: true });
  }

  audio.pause();
  setPlaying(false);

  panel.classList.add('active');
  document.querySelector('.player-area').classList.add('mv-mode');
  state.mvMode = true;

  panel.addEventListener('click', (e) => {
    if (e.target === panel || e.target === inner) hideInlineMV();
  });

  inner.querySelectorAll('.mv-quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const switchUrl = btn.dataset.url;
      if (switchUrl) { vid.src = switchUrl; vid.play().catch(() => { }); }
      inner.querySelectorAll('.mv-quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  vid.addEventListener('ended', () => { playNextMV(); });

  vid.play().catch(() => {
    const overlay = document.createElement('div');
    overlay.className = 'mv-autoplay-overlay';
    overlay.innerHTML = '<button class="mv-autoplay-btn">&#9654; 点击继续播放</button>';
    overlay.addEventListener('click', () => {
      vid.play().catch(() => { });
      overlay.remove();
    });
    inner.appendChild(overlay);
  });
}

function hideInlineMV() {
  if (!state.mvMode) return;
  const vid = $('inlineMVVideo');
  if (vid) {
    const track = state.playlist[state.currentIndex];
    if (track && vid.currentTime > 0) saveMVPosition(track.name, track.artist || '', vid.currentTime);
    vid.pause();
    vid.src = '';
  }
  $('mvFullInner').innerHTML = '<div class="mv-loading" id="mvFullLoading">搜索视频中…</div>';
  $('mvFullPanel').classList.remove('active');
  document.querySelector('.player-area').classList.remove('mv-mode');
  state.mvMode = false;
}

function hideMVPlayer() { hideInlineMV(); }

async function openMVPanel() {
  const track = state.playlist[state.currentIndex];
  if (!track) { toast('请先选择一首歌曲', true); return; }

  const panel = $('mvFullPanel');
  const inner = $('mvFullInner');

  inner.innerHTML = '<div class="mv-loading">搜索视频中…</div>';
  panel.classList.add('active');
  document.querySelector('.player-area').classList.add('mv-mode');
  state.mvMode = true;
  audio.pause();
  setPlaying(false);

  const cached = getMVCache(track.name, track.artist || '');
  if (cached && cached.videoUrl) {
    showInlineMV(cached.videoUrl, cached.accept, cached.title, cached.lastPosition || 0);
    return;
  }

  try {
    const result = await fetchBiliMV(track.name, track.artist || '');
    setMVCache(track.name, track.artist || '', result);
    showInlineMV(result.video_url, result.accept, result.title || `${track.name} MV`, 0);
  } catch (e) {
    inner.innerHTML = `<div class="mv-loading mv-error">${esc(e.message) || '搜索失败，请检查网络'}</div>`;
  }
}

/**
 * Play next track with MV. Reuses playNext for index calculation,
 * then opens MV if available, falls back to audio.
 */
async function playNextMV() {
  if (state.playlist.length === 0) return;

  if (state.repeat === 'one') {
    const vid = $('inlineMVVideo');
    if (vid) { vid.currentTime = 0; vid.play().catch(() => { }); }
    return;
  }

  if (state.repeat !== 'all' && state.playlist.length <= 1) {
    hideInlineMV();
    setPlaying(false);
    return;
  }

  const next = _nextIndex();

  // Set mvMode false so loadTrack's wasInMVMode logic works
  state.mvMode = false;
  loadTrack(next);

  const track = state.playlist[next];
  if (!track) return;

  const cached = getMVCache(track.name, track.artist || '');
  if (cached && cached.videoUrl) {
    showInlineMV(cached.videoUrl, cached.accept, cached.title, cached.lastPosition || 0);
    return;
  }

  try {
    const result = await fetchBiliMV(track.name, track.artist || '');
    setMVCache(track.name, track.artist || '', result);
    showInlineMV(result.video_url, result.accept, result.title || `${track.name} MV`, 0);
  } catch {
    audio.play().then(() => setPlaying(true)).catch(() => { });
  }
}

function handleCoverClick() { openMVPanel(); }

/* ===== Cover Swipe ===== */

function setupCoverSwipe() {
  const cover = $('coverContainer');
  let startX = 0, startY = 0, startTime = 0;

  cover.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  cover.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const dt = Date.now() - startTime;
    if (dt < 500 && dx > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (!state.mvMode) openMVPanel();
      else hideInlineMV();
    }
  }, { passive: true });
}

/* ===== Playlist Import ===== */

/** @type {Track[]} */
let playlistTracks = [];

/**
 * Load a NetEase playlist by ID.
 * @param {string} playlistId
 */
async function loadPlaylist(playlistId) {
  const panel = $('playlistPanel');
  const infoCard = $('playlistInfoCard');
  const trackList = $('playlistTrackList');

  panel.classList.remove('hidden');
  infoCard.innerHTML = '<p class="loading-text">加载歌单信息…</p>';
  trackList.innerHTML = '';
  playlistTracks = [];

  try {
    const [detailData, tracksData] = await Promise.all([
      getPlaylistDetail(playlistId),
      getPlaylistTracks(playlistId, 200),
    ]);

    if (detailData.code !== 200) {
      infoCard.innerHTML = `<p class="loading-text">歌单加载失败: ${esc(detailData.message || String(detailData.code))}</p>`;
      return;
    }

    const pl = detailData.playlist || {};
    const cover = pl.coverImgUrl ? pl.coverImgUrl + '?param=200y200' : '';
    const name = pl.name || '未知歌单';
    const desc = pl.description || '';
    const trackCount = pl.trackCount || 0;

    infoCard.innerHTML = `
      <div class="pl-card-inner">
        ${cover ? `<img class="pl-cover" src="${esc(cover)}" alt="歌单封面">` : ''}
        <div class="pl-meta">
          <div class="pl-name">${esc(name)}</div>
          ${desc ? `<div class="pl-desc">${esc(desc.slice(0, 60))}${desc.length > 60 ? '…' : ''}</div>` : ''}
          <div class="pl-count">${trackCount} 首歌曲</div>
          <button class="btn-outline btn-sm pl-add-all" id="plAddAllBtn">全部添加到列表</button>
        </div>
      </div>`;

    $('plAddAllBtn').addEventListener('click', () => addPlaylistToQueue());

    const songs = tracksData.songs || [];
    playlistTracks = songs.map(song => {
      const artists = (song.ar || song.artists || []).map(a => a.name).join(' / ');
      const cover = (song.al || song.album)?.picUrl || '';
      return {
        id: String(song.id),
        name: song.name,
        artist: artists,
        album: (song.al || song.album)?.name || '',
        cover: cover ? cover + '?param=300y300' : '',
        duration: song.dt || song.duration || 0,
        type: 'online',
        source: 'netease',
        url: null
      };
    });

    if (playlistTracks.length === 0) {
      trackList.innerHTML = '<p class="loading-text">暂无歌曲</p>';
      return;
    }

    trackList.innerHTML = '';
    playlistTracks.forEach((track, i) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.style.animationDelay = `${i * 0.02}s`;
      item.innerHTML = `
        <div class="result-info">
          <div class="result-name">${esc(track.name)}</div>
          <div class="result-meta">${esc(track.artist)}${track.album ? ' · ' + esc(track.album) : ''}</div>
        </div>
        <button class="result-add" title="添加到列表" aria-label="添加 ${esc(track.name)} 到列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>`;

      item.addEventListener('click', e => {
        if (e.target.closest('.result-add')) {
          addTrack(track);
          toast(`已添加: ${track.name}`);
        } else {
          const idx = addTrack(track);
          playTrack(typeof idx === 'number' ? idx : state.playlist.length - 1);
          showPanel('playlist');
        }
      });

      trackList.appendChild(item);
    });

  } catch (err) {
    infoCard.innerHTML = '<p class="loading-text">加载失败，请检查服务是否启动</p>';
    console.error('loadPlaylist error:', err);
  }
}

function addPlaylistToQueue() {
  if (playlistTracks.length === 0) { toast('请先加载歌单', true); return; }
  playlistTracks.forEach(t => addTrack(t));
  toast(`已添加 ${playlistTracks.length} 首歌曲`);
  showPanel('playlist');
}

/* ===== Event Bindings ===== */

function init() {
  // Restore persisted settings
  const settings = loadSettings();
  if (typeof settings.volume === 'number') {
    state.volume = settings.volume;
  }
  if (typeof settings.shuffle === 'boolean') {
    state.shuffle = settings.shuffle;
    $('shuffleBtn').classList.toggle('active', state.shuffle);
  }
  if (settings.repeat) {
    state.repeat = settings.repeat;
    const btn = $('repeatBtn');
    btn.classList.toggle('active', state.repeat !== 'none');
    btn.querySelector('.icon-repeat').classList.toggle('hidden', state.repeat === 'one');
    btn.querySelector('.icon-repeat-one').classList.toggle('hidden', state.repeat !== 'one');
  }
  if (settings.quality && QUALITY_LABEL[settings.quality]) {
    state.quality = settings.quality;
    $('qualityLabel').textContent = QUALITY_LABEL[settings.quality];
    document.querySelectorAll('.quality-option').forEach(b => {
      b.classList.toggle('active', b.dataset.quality === settings.quality);
    });
  }

  audio.volume = state.volume;
  $('volumeFill').style.width = (state.volume * 100) + '%';
  $('volumeThumb').style.left = (state.volume * 100) + '%';

  // Controls
  $('playBtn').addEventListener('click', togglePlay);
  $('prevBtn').addEventListener('click', playPrev);
  $('nextBtn').addEventListener('click', playNext);
  $('shuffleBtn').addEventListener('click', toggleShuffle);
  $('repeatBtn').addEventListener('click', toggleRepeat);
  $('muteBtn').addEventListener('click', toggleMute);
  $('clearPlaylist').addEventListener('click', () => {
    if (state.playlist.length === 0) return;
    if (confirm('清空播放列表？')) {
      state.playlist = [];
      state.currentIndex = -1;
      resetPlayer();
      renderPlaylist();
    }
  });

  // Sidebar
  $('sidebarToggle').addEventListener('click', toggleSidebar);
  $('sidebarClose').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.remove('active');
    if (window.innerWidth > 767) $('sidebar').classList.toggle('collapsed');
  });
  $('sidebarBackdrop').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.remove('active');
  });

  // Nav tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => openSidebarPanel(btn.dataset.panel));
  });

  // Search with debounce
  const searchInput = $('searchInput');
  $('searchBtn').addEventListener('click', () => {
    const val = searchInput.value.trim();
    if (val) searchSongs(val); // Immediate on button click
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = searchInput.value.trim();
      if (val) searchSongs(val);
    }
  });
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    if (val) triggerSearch(val); // Debounced on typing
  });

  // Playlist import
  const playlistInput = $('playlistInput');
  $('playlistLoadBtn').addEventListener('click', () => {
    const id = playlistInput.value.trim();
    if (id) loadPlaylist(id);
  });
  playlistInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && playlistInput.value.trim()) loadPlaylist(playlistInput.value.trim());
  });

  // Local files
  $('selectFilesBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => handleFiles(e.target.files));

  const dropZone = $('dropZone');
  dropZone.addEventListener('click', () => $('fileInput').click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  // Playlist click
  $('playlist').addEventListener('click', e => {
    const item = e.target.closest('.playlist-item');
    if (!item) return;
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      removeTrack(parseInt(removeBtn.dataset.remove));
      return;
    }
    playTrack(parseInt(item.dataset.index));
  });

  $('playlist').addEventListener('contextmenu', e => {
    const item = e.target.closest('.playlist-item');
    if (!item) return;
    e.preventDefault();
    const idx = parseInt(item.dataset.index);
    state.contextTarget = state.playlist[idx];
    state.contextIndex = idx;
    showContextMenu(e.clientX, e.clientY, false);
  });

  // Context menu actions
  $('ctxPlay').addEventListener('click', () => {
    if (state.contextIndex >= 0) playTrack(state.contextIndex);
    else { const idx = addTrack(state.contextTarget); playTrack(idx); showPanel('playlist'); }
    hideContextMenu();
  });
  $('ctxAddNext').addEventListener('click', () => {
    addTrack(state.contextTarget, 'next');
    toast('已添加到下一首');
    hideContextMenu();
  });
  $('ctxAddEnd').addEventListener('click', () => {
    addTrack({ ...state.contextTarget, id: '' }, 'end');
    toast('已添加到列表末尾');
    hideContextMenu();
  });
  $('ctxRemove').addEventListener('click', () => {
    if (state.contextIndex >= 0) removeTrack(state.contextIndex);
    hideContextMenu();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.context-menu')) hideContextMenu();
  });

  // Quality selector
  $('qualityBtn').addEventListener('click', e => {
    e.stopPropagation();
    $('qualityDropdown').classList.toggle('hidden');
  });
  document.querySelectorAll('.quality-option').forEach(btn => {
    btn.addEventListener('click', () => setQuality(btn.dataset.quality));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#qualitySelector')) {
      $('qualityDropdown').classList.add('hidden');
    }
  });

  // MV arrow button
  $('mvArrowBtn').addEventListener('click', e => {
    e.stopPropagation();
    openMVPanel();
  });

  // Cover swipe
  setupCoverSwipe();

  // Lyrics
  $('lyricsToggle').addEventListener('click', () => {
    state.lyricsVisible = !state.lyricsVisible;
    $('lyricsOverlay').classList.toggle('hidden', !state.lyricsVisible);
    $('lyricsToggle').classList.toggle('active', state.lyricsVisible);
  });
  $('lyricsClose').addEventListener('click', () => {
    state.lyricsVisible = false;
    $('lyricsOverlay').classList.add('hidden');
    $('lyricsToggle').classList.remove('active');
  });

  // Progress & volume drag
  setupProgressDrag();
  setupVolumeDrag();

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); }
    else if (e.code === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (e.code === 'ArrowUp') { setVolume(Math.min(1, state.volume + 0.05)); }
    else if (e.code === 'ArrowDown') { setVolume(Math.max(0, state.volume - 0.05)); }
    else if (e.code === 'KeyN') playNext();
    else if (e.code === 'KeyP') playPrev();
    else if (e.code === 'KeyM') toggleMute();
  });

  // Touch gestures
  setupTouchGestures();
  setupCoverLongPress();

  // Resize canvas
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Load hot searches (non-critical)
  loadHotSearches();

  // Start visualizer
  drawVisualizer();
}

document.addEventListener('DOMContentLoaded', init);
