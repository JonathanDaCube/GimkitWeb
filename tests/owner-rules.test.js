const test = require('node:test');
const assert = require('node:assert/strict');

test('Firebase rules grant owner roles only to verified matching accounts', {
  skip: !process.env.FIREBASE_DATABASE_EMULATOR_HOST
}, async () => {
  const { initializeApp, deleteApp } = require('firebase/app');
  const { getDatabase, connectDatabaseEmulator, ref, get, set, remove } = require('firebase/database');
  const [host, port] = process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(':');
  const apps = [];
  function client(name, email, verified = true) {
    const app = initializeApp({ projectId: 'demo-gimkit', databaseURL: `http://${host}:${port}?ns=demo-gimkit-default-rtdb` }, name);
    apps.push(app);
    const db = getDatabase(app);
    connectDatabaseEmulator(db, host, Number(port), {
      mockUserToken: { sub: name, email, email_verified: verified, firebase: { sign_in_provider: 'password' } }
    });
    return db;
  }
  const bootstrap = client('bootstrap', 'jonathandacube@gmail.com');
  const oldBootstrap = client('old-bootstrap', 'jonathanlam0820@gmail.com');
  const unverifiedBootstrap = client('unverified-bootstrap', 'jonathanlam0820@gmail.com', false);
  const owner = client('owner', 'owner@example.com');
  const admin = client('admin', 'admin@example.com');
  const legacy = client('legacy', 'legacy@example.com');
  const unverified = client('unverified', 'unverified@example.com', false);
  const mismatched = client('mismatched', 'actual@example.com');
  const outsider = client('outsider', 'outsider@example.com');
  const denied = async promise => assert.rejects(promise, error => /permission[ _]denied/i.test(error.message));

  try {
    await set(ref(bootstrap, 'admins'), {
      owner: { email: 'owner@example.com', owner: true },
      admin: { email: 'admin@example.com', owner: false },
      legacy: { email: 'legacy@example.com' },
      unverified: { email: 'unverified@example.com', owner: true },
      mismatched: { email: 'different@example.com', owner: true }
    });
    await get(ref(owner, 'admins'));
    await get(ref(owner, 'users'));
    await get(ref(oldBootstrap, 'admins'));
    await get(ref(oldBootstrap, 'users'));
    await set(ref(oldBootstrap, 'admins/admin/owner'), true);
    await set(ref(oldBootstrap, 'admins/admin/owner'), false);
    await denied(get(ref(unverifiedBootstrap, 'admins')));
    await denied(set(ref(unverifiedBootstrap, 'admins/admin/owner'), true));
    await set(ref(owner, 'admins/admin/owner'), true);
    await set(ref(owner, 'admins/admin/owner'), false);
    await denied(set(ref(owner, 'admins/admin/owner'), 'true'));
    await denied(get(ref(admin, 'admins')));
    await denied(get(ref(admin, 'users')));
    await denied(set(ref(admin, 'admins/admin/owner'), true));
    await denied(set(ref(legacy, 'admins/legacy/owner'), true));
    await denied(get(ref(unverified, 'admins')));
    await denied(get(ref(mismatched, 'admins')));
    await denied(set(ref(outsider, 'admins/outsider'), { email: 'outsider@example.com', owner: true }));
    const now = Date.now();
    const vote = {
      title: 'Vote', description: 'Description', choices: { 1: 'Yes', 2: 'No' },
      settings: { startAt: now + 600000, endAt: now + 1200000, showPopup: true, announceResults: true },
      createdAt: now, approvedAt: now, approvedBy: 'owner'
    };
    await set(ref(owner, 'voteCatalog/owner-vote'), vote);
    await set(ref(oldBootstrap, 'voteCatalog/old-owner-vote'), vote);
    await denied(set(ref(admin, 'voteCatalog/admin-vote'), vote));
    await set(ref(admin, 'news/example'), { title: 'News' });
    await set(ref(legacy, 'news/legacy'), { title: 'News' });
  } finally {
    await remove(ref(bootstrap, 'admins'));
    await remove(ref(bootstrap, 'news/example'));
    await remove(ref(bootstrap, 'news/legacy'));
    await Promise.all(apps.map(deleteApp));
  }
});
