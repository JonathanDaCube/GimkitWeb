const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createScoreboard(withChart = false) {
  const listeners = {};
  function element() {
    return {
      children: [],
      textContent: '',
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); },
      setAttribute() {},
      addEventListener() {}
    };
  }
  const lists = {
    scoreboardParticipationList: element(),
    scoreboardTotalList: element(),
    homeScoreboardList: element()
  };
  if (withChart) {
    for (const id of ['skillRadar', 'skillRadarGrid', 'skillArea', 'skillTotalValue', 'skillChartStatus',
      'skillModeValues', 'scoreUserInfo', 'scoreSignInLink', 'scoreSignUpLink', 'scoreSignOut']) {
      lists[id] = element();
    }
  }
  let onAuth;
  const auth = { currentUser: null, onAuthStateChanged(callback) { onAuth = callback; } };
  const db = {
    ref(name) {
      return {
        on(event, callback, onError) { listeners[name] = { callback, onError }; },
        once: async () => ({ val: () => 'alice' })
      };
    }
  };
  const firebase = {
    apps: [{}],
    auth: () => auth,
    database: () => db
  };
  const document = {
    getElementById(id) { return lists[id] || null; },
    querySelectorAll() { return []; },
    createElement: element,
    createElementNS: element
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'scoreboard.js'), 'utf8'),
    { window: { firebase, location: { pathname: '/GimkitWeb/scoreboard/', search: '', hash: '' },
      accountUsernames: { ensure: async () => 'alice' } }, firebase, document, console, TextEncoder, Intl }
  );
  return {
    emit(name, value) {
      listeners[name].callback({
        val: () => value,
        forEach: callback => Object.values(value).forEach(record => callback({ val: () => record }))
      });
    },
    fail(name) { listeners[name].onError(new Error('offline')); },
    rows(id = 'scoreboardParticipationList') { return lists[id].children.map(child => child.textContent); },
    text(id) { return lists[id].textContent; },
    async signIn(user) { auth.currentUser = user; await onAuth(user); }
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
    second: match('Knockback', [{ username: 'ali', place: 1 }, { username: 'carol', place: 2 }]),
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

test('excludes Fishtopia and displays five-mode averages to two decimal places', async () => {
  const scoreboard = createScoreboard(true);
  scoreboard.emit('usernameIndex', { alice: 'a', bob: 'b' });
  scoreboard.emit('usernameDirectory', { a: 'alice', b: 'bob' });
  scoreboard.emit('eloMatches', {
    first: match('Tag', [{ username: 'alice', place: 1 }, { username: 'bob', place: 2 }]),
    second: match('Tag', [{ username: 'alice', place: 1 }, { username: 'bob', place: 2 }]),
    removed: match('Fishtopia', [{ username: 'carol', place: 1 }, { username: 'alice', place: 2 }])
  });
  assert.deepEqual(scoreboard.rows(), ['1. alice — 2 points', '2. bob — 2 points']);
  const formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const expected = formatter.format((200 + 54 + 8 / (1 + Math.pow(10, (54 - 48) / 400))) / 5);
  assert.equal(scoreboard.rows('scoreboardTotalList')[0], `1. alice — ${expected} Elo`);
  assert.equal(scoreboard.rows('homeScoreboardList')[0], `1. alice — ${expected} Elo`);
  await scoreboard.signIn({ uid: 'a', email: 'alice@example.com', emailVerified: true,
    isAnonymous: false, reload: async () => {} });
  assert.equal(scoreboard.text('skillTotalValue'), expected);
  assert.equal(scoreboard.rows('skillModeValues').length, 5);
  assert.equal(scoreboard.rows('skillModeValues').some(row => row.includes('Fishtopia')), false);
});

test('shows empty and unavailable states for participation', () => {
  const scoreboard = createScoreboard();
  scoreboard.emit('eloMatches', {});
  assert.deepEqual(scoreboard.rows(), ['No approved match results yet.']);
  scoreboard.fail('eloMatches');
  assert.deepEqual(scoreboard.rows(), ['The scoreboard is temporarily unavailable.']);
});
