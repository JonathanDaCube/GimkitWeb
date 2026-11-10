(() => {
  function normalize(username) {
    return username.trim().toLowerCase();
  }

  function validate(username) {
    if (typeof username !== 'string') {
      const error = new Error('Choose a valid username.');
      error.code = 'username/invalid';
      throw error;
    }
    const normalized = normalize(username);
    if (!/^[a-z0-9_-]{3,20}$/.test(normalized)) {
      const error = new Error('Usernames must be 3–20 characters using letters, numbers, underscores, or hyphens.');
      error.code = 'username/invalid';
      throw error;
    }
    return normalized;
  }

  async function claim(username, user) {
    if (!user || user.isAnonymous) throw new Error('Sign in before choosing a username.');
    const normalized = validate(username);
    const profileSnapshot = await firebase.database().ref(`users/${user.uid}`).once('value');
    const profile = profileSnapshot.val() || {};
    const indexRef = firebase.database().ref(`usernameIndex/${normalized}`);
    const transaction = await indexRef.transaction(current =>
      current === null || current === user.uid ? user.uid : undefined,
    undefined, false);
    if (!transaction.committed) {
      const error = new Error('That username is already taken. Choose another one.');
      error.code = 'username/already-taken';
      throw error;
    }

    for (const oldName of [profile.username, profile.scoreboardUsername]) {
      if (typeof oldName !== 'string' || !oldName) continue;
      const oldAlias = normalize(oldName);
      if (oldAlias === normalized || !/^[a-z0-9_-]{3,20}$/.test(oldAlias)) continue;
      await firebase.database().ref(`usernameIndex/${oldAlias}`).transaction(current =>
        current === null || current === user.uid ? user.uid : undefined,
      undefined, false);
    }
    const updates = {
      [`users/${user.uid}/username`]: normalized,
      [`users/${user.uid}/updatedAt`]: firebase.database.ServerValue.TIMESTAMP,
      [`usernameDirectory/${user.uid}`]: normalized
    };
    if (user.email) updates[`users/${user.uid}/email`] = user.email.toLowerCase();
    await firebase.database().ref().update(updates);
    return normalized;
  }

  async function ensure(user) {
    if (!user || user.isAnonymous) return '';
    const snapshot = await firebase.database().ref(`users/${user.uid}`).once('value');
    const profile = snapshot.val() || {};
    const username = profile.username || profile.scoreboardUsername || '';
    if (!username) return '';
    let normalized;
    try {
      normalized = validate(username);
    } catch (error) {
      error.code = 'username/invalid';
      throw error;
    }
    const indexSnapshot = await firebase.database().ref(`usernameIndex/${normalized}`).once('value');
    const directorySnapshot = await firebase.database().ref(`usernameDirectory/${user.uid}`).once('value');
    const legacy = profile.scoreboardUsername ? normalize(profile.scoreboardUsername) : '';
    let legacyReady = !/^[a-z0-9_-]{3,20}$/.test(legacy) || legacy === normalized;
    if (!legacyReady) {
      const legacySnapshot = await firebase.database().ref(`usernameIndex/${legacy}`).once('value');
      legacyReady = Boolean(legacySnapshot.val());
    }
    if (indexSnapshot.val() === user.uid &&
        directorySnapshot.val() === normalized &&
        legacyReady) {
      return normalized;
    }
    return claim(normalized, user);
  }

  window.accountUsernames = { normalize, validate, claim, ensure };
})();
