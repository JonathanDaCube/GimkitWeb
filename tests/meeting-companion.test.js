const test = require('node:test');
const assert = require('node:assert/strict');
const { newState, processMeetings } = require('../companion/meetings');

function harness(initialState = newState()) {
  const messages = [];
  let saved;
  return {
    messages,
    state: initialState,
    saved: () => JSON.parse(saved),
    check(active, scheduled, now, notify = async title => messages.push(title)) {
      return processMeetings(initialState, active, scheduled, now, notify, async state => {
        saved = JSON.stringify(state);
      });
    }
  };
}

test('first check skips old meetings and watches future scheduled starts', async () => {
  const app = harness();
  const scheduled = {
    old: { title: 'Old', scheduledAt: 50, createdAt: 1 },
    future: { title: 'Future', scheduledAt: 200, createdAt: 1 }
  };
  await app.check({ old: { title: 'Already active' } }, scheduled, 100);
  await app.check({ old: { title: 'Already active' } }, scheduled, 200);
  await app.check({ old: { title: 'Already active' } }, scheduled, 210);
  assert.deepEqual(app.messages, ['Future']);
});

test('scheduled and activated records notify only once in either order, including after restart', async () => {
  const app = harness();
  const scheduled = { s: { title: 'Meeting', scheduledAt: 200, createdAt: 1 } };
  await app.check({}, scheduled, 100);
  await app.check({}, scheduled, 200);
  const restarted = harness(app.saved());
  await restarted.check({ a: { title: 'Meeting', scheduledAt: 200, scheduledMeetingId: 's' } }, {}, 210);
  assert.deepEqual(app.messages, ['Meeting']);
  assert.deepEqual(restarted.messages, []);

  const early = harness();
  await early.check({}, scheduled, 100);
  await early.check({ a: { title: 'Meeting', scheduledAt: 200, scheduledMeetingId: 's' } }, scheduled, 150);
  await early.check({}, scheduled, 200);
  assert.deepEqual(early.messages, ['Meeting']);
});

test('legacy activations match an unambiguous previously observed scheduled meeting', async () => {
  const app = harness();
  await app.check({}, { s: { title: 'Meeting', scheduledAt: 200 } }, 100);
  await app.check({}, { s: { title: 'Meeting', scheduledAt: 200 } }, 200);
  await app.check({ a: { title: 'Meeting', scheduledAt: 200 } }, {}, 210);
  assert.deepEqual(app.messages, ['Meeting']);
});

test('distinct scheduled meetings with identical titles and times each notify', async () => {
  const app = harness();
  const scheduled = {
    first: { title: 'Meeting', scheduledAt: 200 },
    second: { title: 'Meeting', scheduledAt: 200 }
  };
  await app.check({}, scheduled, 100);
  await app.check({ active: { title: 'Meeting', scheduledAt: 200, scheduledMeetingId: 'first' } }, scheduled, 200);
  assert.deepEqual(app.messages, ['Meeting', 'Meeting']);
});

test('edits, cancellations, and new active meetings are reflected on later checks', async () => {
  const app = harness();
  await app.check({}, { s: { title: 'Meeting', scheduledAt: 200 } }, 100);
  await app.check({}, { s: { title: 'Rescheduled', scheduledAt: 300 } }, 200);
  await app.check({}, {}, 300);
  await app.check({ a: { title: 'New meeting' } }, {}, 310);
  assert.deepEqual(app.messages, ['New meeting']);
});

test('failed delivery is retried and failed reads cannot become empty lists', async () => {
  const app = harness();
  await app.check({}, {}, 100);
  const active = { a: { title: 'Meeting' } };
  await assert.rejects(app.check(active, {}, 110, async () => { throw new Error('delivery failed'); }), /delivery failed/);
  await app.check(active, {}, 120);
  assert.deepEqual(app.messages, ['Meeting']);
  await assert.rejects(app.check([], {}, 130), /Invalid meeting list/);
});
