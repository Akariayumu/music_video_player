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

// ===== Load & Play =====
function loadTrack(index) {
  if (index < 0 || index >= state.playlist.length) return;
  state.currentIndex = index;
  const track = state.playlist[index];

  $('songTitle').textContent = track.name;
  $('songArtist').textContent = track.artist || '';
  $('songAlbum').textContent = track.album || '';
  $('currentSongTitle').textContent = track.name;
  $('currentSongArtist').textContent = track.artist || '';
  $('lyricsSongTitle').textContent = track.name;
  $('lyricsSongArtist').textContent = track.artist || '';

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
    const fetchUrl = track.source === 'kuwo'
      ? fetchKuwoPlayUrl(track.name, track.artist)
      : fetchSongUrl(track.id);
    fetchUrl.then(url => {
      if (url) {
        track.url = url;
        audio.src = url;
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        toast('无法获取播放链接，请检查网络', true);
      }
    });
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
  $('coverWrapper').parentElement.classList.toggle('playing', val);
}

function resetPlayer() {
  state.isPlaying = false;
  audio.src = '';
  $('songTitle').textContent = 'Music Player';
  $('songArtist').textContent = '选择一首歌开始播放';
  $('songAlbum').textContent = '';
  $('currentSongTitle').textContent = '未在播放';
  $('currentSongArtist').textContent = '';
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

audio.addEventListener('error', () => {
  const t = state.playlist[state.currentIndex];
  if (t && t.type === 'online') {
    toast('播放失败，尝试重新获取链接…', true);
    t.url = null;
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
  if (offset === 0) results.innerHTML = '<p class="loading-text">搜索中…</p>';

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

    // Merge: interleave for balanced relevance ordering
    const merged = [];
    const maxLen = Math.max(neteaseTracks.length, kuwoTracks.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < neteaseTracks.length) merged.push(neteaseTracks[i]);
      if (i < kuwoTracks.length) merged.push(kuwoTracks[i]);
    }

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

  // Update inline lyric below cover
  const lyricEl = $('currentLyric');
  if (idx >= 0 && state.lyrics[idx]) {
    lyricEl.textContent = state.lyrics[idx].text;
    lyricEl.classList.add('has-lyric');
  } else {
    lyricEl.textContent = '暂无歌词';
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
  if (window.innerWidth <= 640) {
    sb.classList.toggle('open');
  } else {
    sb.classList.toggle('collapsed');
  }
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  $(`panel-${name}`).classList.add('active');
  document.querySelector(`.nav-item[data-panel="${name}"]`).classList.add('active');
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
    if (track.source === 'kuwo') {
      fetchKuwoPlayUrl(track.name, track.artist).then(url => {
        if (url) {
          track.url = url;
          audio.src = url;
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
  $('sidebarClose').addEventListener('click', toggleSidebar);

  // Nav tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  // Search
  const searchInput = $('searchInput');
  $('searchBtn').addEventListener('click', () => { if (searchInput.value.trim()) searchSongs(searchInput.value.trim()); });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter' && searchInput.value.trim()) searchSongs(searchInput.value.trim()); });

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

  // Resize canvas
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Load hot searches (non-critical, may fail if server not running)
  loadHotSearches();

  // Start visualizer loop
  drawVisualizer();
}

document.addEventListener('DOMContentLoaded', init);
