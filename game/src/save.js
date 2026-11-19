// save.js — the continue-from-save slot in localStorage: cash, story
// progress and where Nico was standing, written after every payday.

const KEY = 'solano-bay-save-v7';

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function writeSave(G) {
  try {
    const data = {
      cash: G.player.cash,
      health: G.player.health,
      armour: G.player.armour,
      missionIndex: G.missions.index,
      storyDone: G.missions.storyDone,
      jobsDone: G.missions.jobsDone,
      x: G.player.x,
      y: G.player.y,
      timeOfDay: G.timeOfDay,
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the game still plays */
  }
}
