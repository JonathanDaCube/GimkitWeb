const { createHash } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { onValueCreated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');

initializeApp();

const database = getDatabase();
const messaging = getMessaging();
const region = 'asia-southeast1';
const databaseInstance = 'gimkit-web-default-rtdb';
const ownerEmail = 'jonathanlam0820@gmail.com';
const defaultPreferences = {
  gameStarted: true,
  meetingStarted: true,
  meetingStartingSoon: true,
  scorePending: false,
  newNews: false
};

function tokenKey(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function getAllTokenUserIds() {
  const snapshot = await database.ref('notificationTokens').once('value');
  const userIds = [];
  snapshot.forEach(userSnapshot => {
    if (userSnapshot.exists()) userIds.push(userSnapshot.key);
  });
  return userIds;
}

async function getAdminUserIds() {
  const adminsSnapshot = await database.ref('admins').once('value');
  let owner = null;
  try {
    owner = await getAuth().getUserByEmail(ownerEmail);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    logger.warn('Could not find the owner account for score notifications.');
  }
  const userIds = new Set();
  adminsSnapshot.forEach(adminSnapshot => {
    if (adminSnapshot.val() && adminSnapshot.val().email) userIds.add(adminSnapshot.key);
  });
  if (owner) userIds.add(owner.uid);
  return Array.from(userIds);
}

async function sendToUsers(userIds, preferenceKey, payload) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const tokens = [];

  for (let offset = 0; offset < uniqueIds.length; offset += 50) {
    const batch = uniqueIds.slice(offset, offset + 50);
    const users = await Promise.all(batch.map(async uid => {
      const [preferenceSnapshot, tokenSnapshot] = await Promise.all([
        database.ref(`notificationPreferences/${uid}/${preferenceKey}`).once('value'),
        database.ref(`notificationTokens/${uid}`).once('value')
      ]);
      const enabled = preferenceSnapshot.exists()
        ? preferenceSnapshot.val() === true
        : defaultPreferences[preferenceKey];
      if (!enabled) return [];
      const userTokens = [];
      tokenSnapshot.forEach(tokenEntry => {
        const token = tokenEntry.val();
        if (typeof token === 'string' && token.length > 0) {
          userTokens.push({ uid, key: tokenEntry.key, token });
        }
      });
      return userTokens;
    }));
    users.forEach(userTokens => tokens.push(...userTokens));
  }

  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: batch.map(entry => entry.token),
      data: {
        title: String(payload.title).slice(0, 100),
        body: String(payload.body).slice(0, 300),
        url: String(payload.url || '/GimkitWeb/').slice(0, 500)
      },
      webpush: { headers: { TTL: '3600' } }
    });

    const invalidTokens = [];
    result.responses.forEach((response, index) => {
      if (!response.success &&
          ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(response.error && response.error.code)) {
        const tokenEntry = batch[index];
        invalidTokens.push(database.ref(`notificationTokens/${tokenEntry.uid}/${tokenEntry.key}`).remove());
      }
    });
    await Promise.all(invalidTokens);
  }
}

exports.notifyGameStarted = onValueCreated(
  { ref: '/activeGames/{gameId}', instance: databaseInstance, region },
  async event => {
    const game = event.data.val();
    return sendToUsers(await getAllTokenUserIds(), 'gameStarted', {
      title: 'A game has started',
      body: `Game code: ${game && game.code ? game.code : 'Open the site to join.'}`,
      url: '/GimkitWeb/'
    });
  }
);

exports.notifyMeetingStarted = onValueCreated(
  { ref: '/activeMeetings/{meetingId}', instance: databaseInstance, region },
  async event => {
    const meeting = event.data.val();
    return sendToUsers(await getAllTokenUserIds(), 'meetingStarted', {
      title: 'A meeting has started',
      body: meeting && meeting.title ? meeting.title : 'Open the site to join.',
      url: '/GimkitWeb/'
    });
  }
);

exports.notifyNewNews = onValueCreated(
  { ref: '/news/{newsId}', instance: databaseInstance, region },
  async event => {
    const news = event.data.val();
    if (!news || !news.title) return null;
    return sendToUsers(await getAllTokenUserIds(), 'newNews', {
      title: 'New Gimkit Community news',
      body: news.title,
      url: '/GimkitWeb/news/'
    });
  }
);

exports.notifyScorePending = onValueCreated(
  { ref: '/scoreSubmissions/{uid}/{submissionId}', instance: databaseInstance, region },
  event => {
    const submission = event.data.val();
    if (!submission || submission.status !== 'pending') return null;
    return getAdminUserIds().then(userIds => sendToUsers(userIds, 'scorePending', {
      title: 'A score is awaiting approval',
      body: 'A new score submission is waiting for admin review.',
      url: '/GimkitWeb/admin/'
    }));
  }
);

exports.notifyScheduledMeeting = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC', region },
  async () => {
    const now = Date.now();
    const snapshot = await database.ref('scheduledMeetings').once('value');
    const pending = [];
    snapshot.forEach(meetingSnapshot => {
      const meeting = meetingSnapshot.val();
      if (meeting && Number.isFinite(meeting.scheduledAt) &&
          meeting.scheduledAt > now && meeting.scheduledAt <= now + 5 * 60 * 1000) {
        pending.push({ id: meetingSnapshot.key, ...meeting });
      }
    });

    for (const meeting of pending) {
      const marker = database.ref(`notificationState/scheduledMeetings/${meeting.id}`);
      const claim = await marker.transaction(current =>
        current && current.scheduledAt === meeting.scheduledAt
          ? undefined
          : { scheduledAt: meeting.scheduledAt, claimedAt: now }
      );
      if (!claim.committed) continue;

      try {
        await sendToUsers(await getAllTokenUserIds(), 'meetingStartingSoon', {
          title: 'A scheduled event starts soon',
          body: `${meeting.title} starts in about 5 minutes.`,
          url: '/GimkitWeb/'
        });
        await marker.update({ sentAt: Date.now() });
      } catch (error) {
        await marker.remove();
        throw error;
      }
    }
  }
);
