'use strict';

function records(value) {
  if (value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid meeting list received from Firebase');
  }
  return value;
}

function validMeeting(meeting) {
  return meeting && typeof meeting.title === 'string' && meeting.title.trim();
}

function scheduledId(meeting, scheduled) {
  if (typeof meeting.scheduledMeetingId === 'string' && meeting.scheduledMeetingId) {
    return meeting.scheduledMeetingId;
  }
  if (!Number.isFinite(meeting.scheduledAt)) return null;
  const matches = Object.entries(scheduled).filter(([, item]) =>
    item.title === meeting.title && item.scheduledAt === meeting.scheduledAt
  );
  return matches.length === 1 ? matches[0][0] : null;
}

async function processMeetings(state, activeValue, scheduledValue, now, notify, save) {
  const active = records(activeValue);
  const scheduled = records(scheduledValue);
  for (const [id, meeting] of Object.entries(scheduled)) {
    if (validMeeting(meeting) && Number.isFinite(meeting.scheduledAt)) {
      state.scheduled[id] = { title: meeting.title, scheduledAt: meeting.scheduledAt };
    }
  }

  if (state.startedAt === null) {
    state.startedAt = now;
    for (const id of Object.keys(active)) state.seenActive[id] = true;
    await save(state);
    return;
  }

  for (const [id, meeting] of Object.entries(active)) {
    if (state.seenActive[id] || !validMeeting(meeting)) continue;
    const relatedId = scheduledId(meeting, state.scheduled);
    if (!relatedId || !state.notifiedScheduled[relatedId]) {
      await notify(meeting.title);
      if (relatedId) state.notifiedScheduled[relatedId] = true;
    }
    state.seenActive[id] = true;
    await save(state);
  }

  for (const [id, meeting] of Object.entries(scheduled)) {
    if (!validMeeting(meeting) || !Number.isFinite(meeting.scheduledAt) ||
        meeting.scheduledAt > now || state.notifiedScheduled[id]) continue;
    if (meeting.scheduledAt < state.startedAt &&
        !(Number.isFinite(meeting.createdAt) && meeting.createdAt >= state.startedAt)) continue;
    await notify(meeting.title);
    state.notifiedScheduled[id] = true;
    await save(state);
  }
  await save(state);
}

function newState() {
  return {
    version: 1,
    startedAt: null,
    seenActive: Object.create(null),
    notifiedScheduled: Object.create(null),
    scheduled: Object.create(null)
  };
}

module.exports = { newState, processMeetings };
