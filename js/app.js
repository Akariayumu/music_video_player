/* ===== Music Player App ===== */

const $ = id => document.getElementById(id);

// ===== State =====
const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeat: 'none', // 'none' | 'all' | 'one'
  volume: 0.8,
  muted: false,
  seeking: false,
  volumeDragging: false,
  contextTarget: null,
  lyrics: [],
  lyricsVisible: false,
  quality: 'standard', // 'standard' | 'exhigh' | 'SQ' | 'lossless' | 'hires'
  mvMode: false,
};

// Quality mappings
const QUALITY_BR = { standard: 128000, exhigh: 320000, SQ: 999000, lossless: 999000, hires: 999000 };
const QUALITY_KUWO_SIZE = { standard: '128kmp3', exhigh: '320kmp3', SQ: '2000kflac', lossless: '2000kflac', hires: 'hires' };
const QUALITY_LABEL = { standard: '标准', exhigh: '极高', SQ: '超品', lossless: '无损', hires: 'Hi-Res' };

// ===== Audio =====
const audio = $('audioPlayer');
audio.crossOrigin = 'anonymous'; // Fix CORS for external audio sources
let audioCtx = null, analyser = null, source = null, animFrame = null;

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ===== Canvas Visualizer =====
const canvas = $('visualizer');
const ctx2d = canvas.getContext('2d');

function drawVisualizer() {
  animFrame = requestAnimationFrame(drawVisualizer);
  if (!analyser) { ctx2d.clearRect(0,0,canvas.width,canvas.height); return; }

  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);

  const w = canvas.width, h = canvas.height;
  ctx2d.clearRect(0,0,w,h);

  const bars = buf.length;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w,h) * 0.37;

  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const amp = (buf[i] / 255) * r * 0.55;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle) * (r + amp);
    const y2 = cy + Math.sin(angle) * (r + amp);

    const grad = ctx2d.createLinearGradient(x1,y1,x2,y2);
    grad.addColorStop(0, 'rgba(124,106,247,0.6)');
    grad.addColorStop(1, 'rgba(233,109,176,0.3)');
    ctx2d.strokeStyle = grad;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(x1,y1);
    ctx2d.lineTo(x2,y2);
    ctx2d.stroke();
  }
}

function resizeCanvas() {
  const c = canvas.parentElement;
  canvas.width = c.offsetWidth * 1.3;
  canvas.height = c.offsetHeight * 1.3;
}

// ===== Playlist Management =====
function addTrack(track, position = 'end') {
  const dup = state.playlist.findIndex(t => t.id === track.id && t.id);
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
      if (wasPlaying) audio.play().catch(() => {});
    }
  } else {
    state.playlist.splice(index, 1);
    if (index < state.currentIndex) state.currentIndex--;
  }
  renderPlaylist();
}

function renderPlaylist() {
  const list = $('playlist');
  const empty = $('playlistEmpty');

  if (state.playlist.length === 0) {
    empty.style.display = 'flex';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = state.playlist.map((t, i) => {
    const active = i === state.currentIndex;
    const thumb = t.cover
      ? `<img src="${t.cover}" class="track-thumb" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const placeholder = `<div class="track-thumb-placeholder" ${t.cover ? 'style="display:none"' : ''}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
        <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="2"/>
      </svg>
    </div>`;
    const dur = t.duration ? fmtTime(t.duration / 1000) : '';
    return `
      <li class="playlist-item ${active ? 'active' : ''}" data-index="${i}">
        <div class="track-index">${i+1}</div>
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
        <button class="track-remove" data-remove="${i}" title="移除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </li>`;
  }).join('');

  // Scroll active item into view
  const activeEl = list.querySelector('.playlist-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

// ===== Marquee for long titles =====
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

// ===== Load & Play =====
function loadTrack(index) {
  if (index < 0 || index >= state.playlist.length) return;
  const wasInMVMode = state.mvMode;
  hideMVPlayer();
  state.currentIndex = index;
  const track = state.playlist[index];

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

  // For online tracks, fetch URL if needed
  if (track.type === 'online' && !track.url) {
    if (track.source === 'kuwo') {
      // Prevent retry loop
      if (track._kuwoFailed) {
        toast('该歌曲暂不可用，请尝试其他音质或其他歌曲', true);
        return;
      }
      fetchKuwoDetailWithFallback(track.name, track.artist).then(({ url, cover }) => {
        if (cover && !track.cover) {
          track.cover = cover;
          const img = $('coverArt');
          img.src = cover;
          img.onload = () => { img.classList.add('loaded'); $('coverPlaceholder').classList.add('hidden'); };
          img.onerror = () => { img.classList.remove('loaded'); $('coverPlaceholder').classList.add('hidden'); };
        }
        if (url) {
          // Try direct URL first, audio error handler will retry via proxy if needed
          track.url = url;
          audio.src = url;
          // Delay auto-play 500ms to let the user see the cover
          setTimeout(() => {
            audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
          }, 500);
        } else {
          track._kuwoFailed = true;
          toast('该歌曲暂不可用', true);
        }
      });
    } else {
      fetchSongUrl(track.id).then(url => {
        if (url) {
          track.url = url;
          audio.src = url;
          audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          toast('无法获取播放链接，请检查网络', true);
        }
      });
    }
  } else if (track.url) {
    audio.src = track.url;
  }

  if (track.type === 'online' && track.source !== 'kuwo') {
    loadLyrics(track.id);
  } else {
    clearLyrics();
  }

  renderPlaylist();
  document.title = `${track.name} - Music Player`;

  // Auto-load MV if previous track was in video mode and new track has cache
  if (wasInMVMode) {
    const cached = getMVCache(track.name, track.artist || '');
    if (cached && cached.videoUrl) {
      setTimeout(() => openMVPanel(), 100);
    }
  }
}

function playTrack(index) {
  loadTrack(index);
  audio.play().then(() => setPlaying(true)).catch(() => {});
}

function togglePlay() {
  if (state.playlist.length === 0) return;
  if (state.currentIndex === -1) { playTrack(0); return; }
  if (audio.paused) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    audio.play().then(() => setPlaying(true)).catch(() => {});
  } else {
    audio.pause();
    setPlaying(false);
  }
}

function setPlaying(val) {
  state.isPlaying = val;
  const playBtn = $('playBtn');
  playBtn.querySelector('.icon-play').classList.toggle('hidden', val);
  playBtn.querySelector('.icon-pause').classList.toggle('hidden', !val);
  if (!state.mvMode) {
    $('coverWrapper').parentElement.classList.toggle('playing', val);
  }
}

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

function playNext() {
  if (state.playlist.length === 0) return;
  let next;
  if (state.shuffle) {
    next = Math.floor(Math.random() * state.playlist.length);
  } else {
    next = state.currentIndex + 1;
    if (next >= state.playlist.length) next = 0;
  }
  playTrack(next);
}

function playPrev() {
  if (state.playlist.length === 0) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prev = state.currentIndex - 1;
  if (prev < 0) prev = state.playlist.length - 1;
  playTrack(prev);
}

// ===== Audio Events =====
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

audio.addEventListener('error', (e) => {
  const t = state.playlist[state.currentIndex];
  // Ignore errors when audio is empty
  if (!audio.src || audio.src === window.location.href) return;

  // If this track was already proxied, skip retry
  if (t && t._proxied) return;

  // If direct URL failed and we have a proxy, retry via proxy
  if (t && t.url && !t._proxyAttempted) {
    t._proxyAttempted = true;
    let proxyUrl = null;
    if (t.source === 'netease') {
      proxyUrl = neteaseProxyUrl(t.url);
    } else if (t.source === 'kuwo') {
      proxyUrl = kuwoProxyUrl(t.url);
    }
    if (proxyUrl && t.url !== proxyUrl) {
      // Retry with proxy
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

  if (t && t.type === 'online') {
    // If kuwo source fails due to CORS, try to fallback to netease
    if (t.source === 'kuwo' && !t._kuwoFailed) {
      t._kuwoFailed = true;
      toast('酷我音源不可用，尝试切换到网易云…', true);
      // Search same song on netease
      const keywords = `${t.name} ${t.artist}`;
      fetch(`/api/search?keywords=${encodeURIComponent(keywords)}&limit=1`)
        .then(r => r.json())
        .then(data => {
          const songs = data.result?.songs || [];
          if (songs.length > 0) {
            const s = songs[0];
            t.id = String(s.id);
            t.source = 'netease';
            t.url = null;
            t._kuwoFailed = false;
            t._retryCount = 0;
            t._proxyAttempted = false;
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
    if (t._kuwoFailed) return;
    t._retryCount = (t._retryCount || 0) + 1;
    if (t._retryCount > 3) {
      t._kuwoFailed = true;
      setPlaying(false);
      toast('播放失败，该歌曲暂不可用', true);
      return;
    }
    t.url = null;
    toast('播放失败，尝试重新获取链接…', true);
    loadTrack(state.currentIndex);
  }
});

// ===== Progress Bar Drag =====
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

// ===== Volume Drag =====
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
}

function toggleMute() {
  state.muted = !state.muted;
  audio.muted = state.muted;
  $('muteBtn').querySelector('.icon-volume').classList.toggle('hidden', state.muted);
  $('muteBtn').querySelector('.icon-mute').classList.toggle('hidden', !state.muted);
}

// ===== Shuffle & Repeat =====
function toggleShuffle() {
  state.shuffle = !state.shuffle;
  $('shuffleBtn').classList.toggle('active', state.shuffle);
  toast(state.shuffle ? '随机播放 开' : '随机播放 关');
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
}

// ===== Online Search =====
async function searchSongs(keywords, offset = 0) {
  const results = $('searchResults');
  if (offset === 0) results.innerHTML = '<p class="loading-text searching">搜索中…</p>';

  try {
    // Call both APIs concurrently; kuwo only on first page
    const [neteaseResult, kuwoResult] = await Promise.allSettled([
      fetch(`/api/search?keywords=${encodeURIComponent(keywords)}&limit=20&offset=${offset}`).then(r => r.json()),
      offset === 0
        ? fetch(`/api/search/kuwo?keywords=${encodeURIComponent(keywords)}`).then(r => r.json())
        : Promise.resolve(null)
    ]);

    const neteaseSongs = neteaseResult.status === 'fulfilled' ? (neteaseResult.value?.result?.songs || []) : [];
    const kuwoSongs = kuwoResult.status === 'fulfilled' && kuwoResult.value ? (kuwoResult.value?.data?.songs || []) : [];

    if (offset === 0) results.innerHTML = '';

    // Fetch cover art for netease songs
    let coverMap = {};
    if (neteaseSongs.length > 0) {
      try {
        const songIds = neteaseSongs.map(s => s.id).join(',');
        const detailRes = await fetch(`/api/song/detail?ids=${songIds}`);
        const detailData = await detailRes.json();
        (detailData.songs || []).forEach(s => {
          const pic = s.al?.picUrl || '';
          if (pic) coverMap[s.id] = pic;
        });
      } catch(e) { console.warn('Failed to fetch covers:', e); }
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

    // Merge: kuwo first (no IP restriction), then netease (browser can access directly)
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
        <button class="result-add" title="添加到列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
        state.contextTarget = { track, index: -1 };
        showContextMenu(e.clientX, e.clientY, true);
      });

      results.appendChild(item);
    });

  } catch (err) {
    results.innerHTML = '<p class="loading-text">搜索失败，请确认服务已启动</p>';
  }
}

async function fetchSongUrl(id) {
  try {
    const br = QUALITY_BR[state.quality] || 128000;
    const res = await fetch(`/api/song/url?id=${id}&br=${br}`);
    const data = await res.json();
    const item = (data.data || [])[0];
    return item?.url || null;
  } catch { return null; }
}

function kuwoProxyUrl(url) {
  if (!url) return url;
  return `/api/kuwo/audio?url=${encodeURIComponent(url)}`;
}

function neteaseProxyUrl(url) {
  if (!url) return url;
  return `/api/netease/audio?url=${encodeURIComponent(url)}`;
}

async function fetchKuwoDetail(name, artist, quality = state.quality) {
  try {
    const msg = artist ? `${name} ${artist}` : name;
    const size = QUALITY_KUWO_SIZE[quality] || '128kmp3';
    const res = await fetch(`/api/kuwo/detail?msg=${encodeURIComponent(msg)}&n=1&size=${encodeURIComponent(size)}`);
    const data = await res.json();
    return { url: data.url || null, cover: data.picture || '' };
  } catch { return { url: null, cover: '' }; }
}

async function fetchKuwoDetailWithFallback(name, artist) {
  const QUALITY_ORDER = ['hires', 'lossless', 'SQ', 'exhigh', 'standard'];
  const startIdx = QUALITY_ORDER.indexOf(state.quality);
  const qualitiesToTry = QUALITY_ORDER.slice(startIdx >= 0 ? startIdx : 0);

  for (const quality of qualitiesToTry) {
    const result = await fetchKuwoDetail(name, artist, quality);
    if (result.url) {
      if (quality !== state.quality) {
        toast(`${QUALITY_LABEL[state.quality]} 不可用，已降级至 ${QUALITY_LABEL[quality]}`);
      }
      return result;
    }
  }
  return { url: null, cover: '' };
}

async function fetchKuwoPlayUrl(name, artist) {
  try {
    const keywords = artist ? `${name} ${artist}` : name;
    const size = QUALITY_KUWO_SIZE[state.quality] || '128kmp3';
    const res = await fetch(`/api/song/url/kuwo?keywords=${encodeURIComponent(keywords)}&size=${encodeURIComponent(size)}`);
    const data = await res.json();
    if (data.url) return data.url;
    // Fallback to netease
    const searchRes = await fetch(`/api/search?keywords=${encodeURIComponent(keywords)}&limit=5`);
    const searchData = await searchRes.json();
    const songs = searchData.result?.songs || [];
    if (songs.length === 0) return null;
    return await fetchSongUrl(String(songs[0].id));
  } catch { return null; }
}

async function loadHotSearches() {
  try {
    const res = await fetch('/api/search/hot');
    const data = await res.json();
    const list = data.data || [];
    const container = $('hotTags');
    if (list.length === 0) { $('hotSearches').style.display = 'none'; return; }
    container.innerHTML = list.slice(0, 10).map(item =>
      `<span class="hot-tag">${esc(item.searchWord || item.first || '')}</span>`
    ).join('');
    container.querySelectorAll('.hot-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        $('searchInput').value = tag.textContent;
        searchSongs(tag.textContent);
      });
    });
  } catch {
    $('hotSearches').style.display = 'none';
  }
}

// ===== Lyrics =====
async function loadLyrics(id) {
  clearLyrics();
  try {
    const res = await fetch(`/api/lyric?id=${id}`);
    const data = await res.json();
    const lrc = data.lrc?.lyric || '';
    state.lyrics = parseLrc(lrc);
    if (state.lyrics.length > 0) renderLyrics();
    else $('lyricsContent').innerHTML = '<p class="lyrics-placeholder">暂无歌词</p>';
  } catch {
    $('lyricsContent').innerHTML = '<p class="lyrics-placeholder">歌词加载失败</p>';
  }
}

function parseLrc(lrc) {
  const lines = [];
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
  let m;
  while ((m = re.exec(lrc)) !== null) {
    const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3].padEnd(3,'0')) / 1000;
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines.sort((a,b) => a.time - b.time);
}

function renderLyrics() {
  $('lyricsContent').innerHTML = state.lyrics.map((l, i) =>
    `<div class="lyric-line" data-index="${i}" data-time="${l.time}">${esc(l.text)}</div>`
  ).join('');

  $('lyricsContent').querySelectorAll('.lyric-line').forEach(el => {
    el.addEventListener('click', () => {
      audio.currentTime = parseFloat(el.dataset.time);
    });
  });
}

function clearLyrics() {
  state.lyrics = [];
  $('lyricsContent').innerHTML = '<p class="lyrics-placeholder">暂无歌词</p>';
  $('currentLyric').textContent = '暂无歌词';
}

let lastLyricIndex = -1;
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

  // Update inline lyric below cover (two lines: current + next)
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

// ===== Local Files =====
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

// ===== Context Menu =====
function showContextMenu(x, y, isSearch = false) {
  const menu = $('contextMenu');
  $('ctxRemove').style.display = isSearch ? 'none' : 'flex';
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

function hideContextMenu() { $('contextMenu').classList.add('hidden'); }

// ===== Sidebar & Panels =====
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
  document.querySelector(`.nav-item[data-panel="${name}"]`).classList.add('active');
  // Sync bottom nav active state
  document.querySelectorAll('.bottom-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
}

// ===== Touch Gestures =====
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
    // Horizontal swipe only: fast, dominant horizontal direction
    if (dt < 500 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      // If swipe started on cover container, let coverSwipe handle it
      if (e.target.closest('#coverContainer')) return;
      if (dx < 0) playNext();
      else playPrev();
    }
  }, { passive: true });
}

// ===== Long Press on Cover =====
function setupCoverLongPress() {
  let longPressTimer = null;
  const cover = $('coverContainer');

  cover.addEventListener('touchstart', () => {
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      const track = state.playlist[state.currentIndex];
      if (!track) return;
      state.contextTarget = { track, index: state.currentIndex };
      const rect = cover.getBoundingClientRect();
      showContextMenu(rect.left + rect.width / 2 - 80, rect.bottom - 20, false);
    }, 600);
  }, { passive: true });

  cover.addEventListener('touchend', () => { clearTimeout(longPressTimer); }, { passive: true });
  cover.addEventListener('touchmove', () => { clearTimeout(longPressTimer); }, { passive: true });
}

// ===== Helpers =====
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ===== Quality =====
function setQuality(quality) {
  state.quality = quality;
  $('qualityLabel').textContent = QUALITY_LABEL[quality] || quality;
  document.querySelectorAll('.quality-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quality === quality);
  });
  $('qualityDropdown').classList.add('hidden');

  // Reload current track URL if it's an online track
  const track = state.playlist[state.currentIndex];
  if (track && track.type === 'online') {
    const wasPlaying = state.isPlaying;
    const currentTime = audio.currentTime;
    track.url = null; // Force re-fetch
    track._proxyAttempted = false; // Reset proxy flag for retry
    if (track.source === 'kuwo') {
      fetchKuwoPlayUrl(track.name, track.artist).then(url => {
        if (url) {
          track.url = url;
          audio.src = track.url;
          audio.currentTime = currentTime;
          if (wasPlaying) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          toast('该音质暂不可用', true);
        }
      });
    } else {
      fetchSongUrl(track.id).then(url => {
        if (url) {
          track.url = url;
          audio.src = url;
          audio.currentTime = currentTime;
          if (wasPlaying) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          toast('该音质暂不可用', true);
        }
      });
    }
  }

  toast(`音质: ${QUALITY_LABEL[quality]}`);
}

// ===== Bilibili MV =====
function cleanSongName(name) {
  return name
    // 去掉各种括号及其内容: (xxx)、[xxx]、{xxx}、（xxx）、【xxx】
    .replace(/[\(\[\{（【].*?[\)\]\}）】]/g, '')
    // 去掉 feat./ft./featuring 及后面的内容（不区分大小写）
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.+$/i, '')
    // 去掉 with 及后面的内容（常用于合作）
    .replace(/\s+with\s+.+$/i, '')
    // 去掉 & 及后面的内容（常用于合作艺人）
    .replace(/\s+&\s+.+$/i, '')
    // 去掉多余空格
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBiliMV(name, artist) {
  // 清理歌曲名，去掉括号、feat等干扰信息
  const cleanName = cleanSongName(name).slice(0, 30);
  const cleanArtist = artist ? artist.replace(/[\(\[\{（【].*?[\)\]\}）】]/g, '').trim() : '';

  // 构建搜索词：清理后的歌曲名 + 清理后的歌手 + MV
  const query = cleanArtist
    ? encodeURIComponent(`${cleanName} ${cleanArtist} MV`)
    : encodeURIComponent(`${cleanName} MV`);

  const res = await fetch(`/api/bilibili?msg=${query}&n=1`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(json.msg || '搜索失败');
  const data = json.data || {};
  const url = data.url || '';
  const bvid = data.bvid || (url.match(/BV[\w]+/) || [])[0];
  if (!bvid) throw new Error('未找到视频BV号');

  const mir6Res = await fetch(`/api/bilibili/mir6?bvid=${bvid}`);
  const mir6Json = await mir6Res.json();
  if (mir6Json.code !== 200) throw new Error(mir6Json.message || '视频解析失败');

  return {
    video_url: mir6Json.video_url,
    accept: mir6Json.accept || [],
    title: data.title || name,
    bvid
  };
}

// ===== MV Cache (localStorage) =====
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
  } catch {}
}

function saveMVPosition(name, artist, position) {
  try {
    const key = mvCacheKey(name, artist);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const cached = JSON.parse(raw);
    cached.lastPosition = position;
    localStorage.setItem(key, JSON.stringify(cached));
  } catch {}
}

// ===== Inline MV Panel =====
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

  // Pause audio while MV plays
  audio.pause();
  setPlaying(false);

  panel.classList.add('active');
  document.querySelector('.player-area').classList.add('mv-mode');
  state.mvMode = true;

  // Click outside video to close (on panel background)
  panel.addEventListener('click', (e) => {
    if (e.target === panel || e.target === inner) {
      hideInlineMV();
    }
  });

  // Quality switching
  inner.querySelectorAll('.mv-quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const switchUrl = btn.dataset.url;
      if (switchUrl) { vid.src = switchUrl; vid.play().catch(() => {}); }
      inner.querySelectorAll('.mv-quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Auto-play next when MV ends
  vid.addEventListener('ended', () => { playNextMV(); });

  // Handle autoplay restriction (common in Chrome/Safari for programmatic plays)
  vid.play().catch(() => {
    const overlay = document.createElement('div');
    overlay.className = 'mv-autoplay-overlay';
    overlay.innerHTML = '<button class="mv-autoplay-btn">&#9654; 点击继续播放</button>';
    overlay.addEventListener('click', () => {
      vid.play().catch(() => {});
      overlay.remove();
    });
    inner.appendChild(overlay);
  });
}

function hideInlineMV() {
  if (!state.mvMode) return;
  const vid = $('inlineMVVideo');
  if (vid) {
    // Save playback position to cache
    const track = state.playlist[state.currentIndex];
    if (track && vid.currentTime > 0) {
      saveMVPosition(track.name, track.artist || '', vid.currentTime);
    }
    vid.pause();
    vid.src = '';
  }
  $('mvFullInner').innerHTML = '<div class="mv-loading" id="mvFullLoading">搜索视频中…</div>';
  $('mvFullPanel').classList.remove('active');
  document.querySelector('.player-area').classList.remove('mv-mode');
  state.mvMode = false;
}

// Keep hideMVPlayer as alias for backward compat (called in loadTrack)
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

  // Check cache first
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

// Auto-play next track's MV when current MV ends
async function playNextMV() {
  if (state.playlist.length === 0) return;

  // Repeat one: replay current MV from beginning
  if (state.repeat === 'one') {
    const vid = $('inlineMVVideo');
    if (vid) { vid.currentTime = 0; vid.play().catch(() => {}); }
    return;
  }

  // No repeat + single track: stop
  if (state.repeat !== 'all' && state.playlist.length <= 1) {
    hideInlineMV();
    setPlaying(false);
    return;
  }

  let next;
  if (state.shuffle) {
    next = Math.floor(Math.random() * state.playlist.length);
  } else {
    next = state.currentIndex + 1;
    if (next >= state.playlist.length) next = 0;
  }

  // Set mvMode false so loadTrack's wasInMVMode logic doesn't conflict
  state.mvMode = false;
  loadTrack(next);

  const track = state.playlist[next];
  if (!track) return;

  // Check cache first
  const cached = getMVCache(track.name, track.artist || '');
  if (cached && cached.videoUrl) {
    showInlineMV(cached.videoUrl, cached.accept, cached.title, cached.lastPosition || 0);
    return;
  }

  // Try to fetch MV; fall back to audio if unavailable
  try {
    const result = await fetchBiliMV(track.name, track.artist || '');
    setMVCache(track.name, track.artist || '', result);
    showInlineMV(result.video_url, result.accept, result.title || `${track.name} MV`, 0);
  } catch (e) {
    // No MV found - play audio normally
    audio.play().then(() => setPlaying(true)).catch(() => {});
  }
}

// Legacy alias used elsewhere
function handleCoverClick() { openMVPanel(); }

// ===== Cover Swipe (right-swipe = open MV) =====
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
    // Right-swipe on cover: open MV
    if (dt < 500 && dx > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (!state.mvMode) openMVPanel();
      else hideInlineMV();
    }
  }, { passive: true });
}

// ===== Playlist Import =====
let playlistTracks = []; // holds tracks from last loaded playlist

async function loadPlaylist(playlistId) {
  const panel = $('playlistPanel');
  const infoCard = $('playlistInfoCard');
  const trackList = $('playlistTrackList');

  panel.classList.remove('hidden');
  infoCard.innerHTML = '<p class="loading-text">加载歌单信息…</p>';
  trackList.innerHTML = '';
  playlistTracks = [];

  try {
    // Fetch playlist detail and tracks in parallel
    const [detailRes, tracksRes] = await Promise.all([
      fetch(`/api/playlist/detail?id=${encodeURIComponent(playlistId)}`),
      fetch(`/api/playlist/track/all?id=${encodeURIComponent(playlistId)}&limit=200`)
    ]);
    const detailData = await detailRes.json();
    const tracksData = await tracksRes.json();

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

    // Build track objects
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
        <button class="result-add" title="添加到列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
    infoCard.innerHTML = `<p class="loading-text">加载失败，请检查服务是否启动</p>`;
    console.error('loadPlaylist error:', err);
  }
}

function addPlaylistToQueue() {
  if (playlistTracks.length === 0) { toast('请先加载歌单', true); return; }
  playlistTracks.forEach(t => addTrack(t));
  toast(`已添加 ${playlistTracks.length} 首歌曲`);
  showPanel('playlist');
}

// ===== Event Bindings =====
function init() {
  // Volume init
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

  // Backdrop closes sidebar on mobile
  $('sidebarBackdrop').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.remove('active');
  });

  // Nav tabs (sidebar internal)
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => openSidebarPanel(btn.dataset.panel));
  });

  // Search
  const searchInput = $('searchInput');
  $('searchBtn').addEventListener('click', () => { if (searchInput.value.trim()) searchSongs(searchInput.value.trim()); });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter' && searchInput.value.trim()) searchSongs(searchInput.value.trim()); });

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
    state.contextTarget = { track: state.playlist[idx], index: idx };
    showContextMenu(e.clientX, e.clientY, false);
  });

  // Context menu actions
  $('ctxPlay').addEventListener('click', () => {
    if (state.contextTarget.index >= 0) playTrack(state.contextTarget.index);
    else { const idx = addTrack(state.contextTarget.track); playTrack(idx); showPanel('playlist'); }
    hideContextMenu();
  });
  $('ctxAddNext').addEventListener('click', () => {
    addTrack(state.contextTarget.track, 'next');
    toast('已添加到下一首');
    hideContextMenu();
  });
  $('ctxAddEnd').addEventListener('click', () => {
    addTrack({ ...state.contextTarget.track, id: '' }, 'end');
    toast('已添加到列表末尾');
    hideContextMenu();
  });
  $('ctxRemove').addEventListener('click', () => {
    if (state.contextTarget.index >= 0) removeTrack(state.contextTarget.index);
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

  // Cover swipe gesture
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

  // Touch gestures (mobile)
  setupTouchGestures();
  setupCoverLongPress();

  // Resize canvas
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Load hot searches (non-critical, may fail if server not running)
  loadHotSearches();

  // Start visualizer loop
  drawVisualizer();
}

document.addEventListener('DOMContentLoaded', init);
