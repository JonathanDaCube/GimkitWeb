const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createScoreboard() {
  const listeners = {};
  const lists = {
    scoreboardParticipationList: {
      children: [],
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); }
    }
  };
  const db = {
    ref(name) {
      return {
        on(event, callback, onError) { listeners[name] = { callback, onError }; }
      };
    }
  };
  const firebase = {
    apps: [{}],
    auth: () => ({}),
    database: () => db
  };
  const document = {
    getElementById(id) { return lists[id] || null; },
    querySelectorAll() { return []; },
    createElement() { return { textContent: '' }; }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'scoreboard.js'), 'utf8'),
    { window: { firebase }, firebase, document, console, TextEncoder, Intl }
  );
  return {
    emit(name, value) {
      listeners[name].callback({
        val: () => value,
        forEach: callback => Object.values(value).forEach(record => callback({ val: () => record }))
      });
    },
    fail(name) { listeners[name].onError(new Error('offline')); },
    rows() { return lists.scoreboardParticipationList.children.map(child => child.textContent); }
  };
}

function match(game, players, status = 'approved') {
  return { game, players, status };
}

test('counts approved matches across modes and combines renamed participants', () => {
  const scoreboard = createScoreboard();
  scoreboard.emit('usernameIndex', { alice: 'a', ali: 'a', bob: 'b' });
  scoreboard.emit('usernameDirectory', { a: 'ali', b: 'bob' });
  scoreboard.emit('eloMatches', {
    first: match('Tag', [{ username: 'alice', place: 2 }, { username: 'bob', place: 1 }]),
    second: match('Fishtopia', [{ username: 'ali', place: 1 }, { username: 'carol', place: 2 }]),
    pending: match('Tag', [{ username: 'bob', place: 1 }, { username: 'carol', place: 2 }], 'pending'),
    invalid: match('Tag', [{ username: 'bob', place: 1 }, { username: 'BOB', place: 2 }])
  });
  assert.deepEqual(scoreboard.rows(), [
    '1. ali — 2 points',
    '2. bob — 1 point',
    '3. carol — 1 point'
  ]);
  scoreboard.emit('usernameDirectory', { a: 'alicia', b: 'bob' });
  assert.deepEqual(scoreboard.rows(), [
    '1. alicia — 2 points',
    '2. bob — 1 point',
    '3. carol — 1 point'
  ]);
});

test('shows empty and unavailable states for participation', () => {
  const scoreboard = createScoreboard();
  scoreboard.emit('eloMatches', {});
  assert.deepEqual(scoreboard.rows(), ['No approved match results yet.']);
  scoreboard.fail('eloMatches');
  assert.deepEqual(scoreboard.rows(), ['The scoreboard is temporarily unavailable.']);
});
