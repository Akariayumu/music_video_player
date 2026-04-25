/**
 * @module storage - localStorage persistence layer for player settings.
 */

const STORAGE_KEY = 'music_player_state';

/**
 * @typedef {Object} PersistedState
 * @property {number} volume - Volume level (0-1)
 * @property {boolean} shuffle - Shuffle mode
 * @property {'none'|'all'|'one'} repeat - Repeat mode
 * @property {string} quality - Audio quality
 */

/**
 * Load persisted settings from localStorage.
 * @returns {PersistedState}
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save settings to localStorage.
 * @param {Partial<PersistedState>} settings
 */
export function saveSettings(settings) {
  try {
    const existing = loadSettings();
    const merged = { ...existing, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Save volume setting.
 * @param {number} volume
 */
export function saveVolume(volume) {
  saveSettings({ volume });
}

/**
 * Save shuffle setting.
 * @param {boolean} shuffle
 */
export function saveShuffle(shuffle) {
  saveSettings({ shuffle });
}

/**
 * Save repeat setting.
 * @param {'none'|'all'|'one'} repeat
 */
export function saveRepeat(repeat) {
  saveSettings({ repeat });
}

/**
 * Save quality setting.
 * @param {string} quality
 */
export function saveQuality(quality) {
  saveSettings({ quality });
}

/**
 * Clear all persisted settings.
 */
export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
