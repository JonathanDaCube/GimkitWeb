'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { newState, processMeetings } = require('./meetings');

const execFileAsync = promisify(execFile);
const database = 'https://gimkit-web-default-rtdb.asia-southeast1.firebasedatabase.app';
const stateDir = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE, 'GimkitWebNotifications');
const stateFile = path.join(stateDir, 'state.json');
const pollInterval = 10_000;

class StateSaveError extends Error {}

async function readState() {
  let data;
  try {
    data = await fs.readFile(stateFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return newState();
    throw error;
  }
  const state = JSON.parse(data);
  const isMap = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!state || state.version !== 1 || !Number.isFinite(state.startedAt) ||
      !isMap(state.seenActive) || !isMap(state.notifiedScheduled) || !isMap(state.scheduled) ||
      Object.values(state.scheduled).some(item =>
        !item || typeof item.title !== 'string' || !Number.isFinite(item.scheduledAt))) {
    throw new Error(`Invalid state file: ${stateFile}`);
  }
  for (const key of ['seenActive', 'notifiedScheduled', 'scheduled']) {
    state[key] = Object.assign(Object.create(null), state[key]);
  }
  return state;
}

async function saveState(state) {
  try {
    await fs.mkdir(stateDir, { recursive: true });
    const temporary = `${stateFile}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state), 'utf8');
    await fs.rename(temporary, stateFile);
  } catch (error) {
    throw new StateSaveError(`Could not save notification state: ${error.message}`, { cause: error });
  }
}

async function fetchList(name) {
  const response = await fetch(`${database}/${name}.json`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Firebase ${name}: HTTP ${response.status}`);
  return response.json();
}

async function notify(title) {
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'notify.ps1')
  ], {
    env: { ...process.env, GIMKIT_MEETING_TITLE: title },
    timeout: 20_000,
    windowsHide: true
  });
  console.log(`Notification sent: ${title}`);
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This companion supports Windows only.');
  const state = await readState();
  console.log('Watching for meetings. Keep this window open; press Ctrl+C to stop.');
  while (true) {
    try {
      const [active, scheduled] = await Promise.all([
        fetchList('activeMeetings'), fetchList('scheduledMeetings')
      ]);
      await processMeetings(state, active, scheduled, Date.now(), notify, saveState);
    } catch (error) {
      if (error instanceof StateSaveError) throw error;
      console.error(`Notification check failed; retrying: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
