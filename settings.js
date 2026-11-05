(() => {
  const firebaseConfig = {
    apiKey: 'AIzaSyDq6eOzOWLd88XG-wFo0LN1O3l2Yyvdfls',
    authDomain: 'gimkit-web.firebaseapp.com',
    databaseURL: 'https://gimkit-web-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'gimkit-web',
    storageBucket: 'gimkit-web.firebasestorage.app',
    messagingSenderId: '192282058649',
    appId: '1:192282058649:web:cdcdfdb49c429fc0e33d08',
    measurementId: 'G-TLCCKP056J'
  };
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const db = firebase.database();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(error => console.error('Could not set authentication persistence:', error));

  const accountStatus = document.getElementById('accountStatus');
  const signedOutMessage = document.getElementById('signedOutMessage');
  const settingsSignIn = document.getElementById('settingsSignIn');
  const accountSettings = document.getElementById('accountSettings');
  const accountIdentity = document.getElementById('accountIdentity');
  const disablePopups = document.getElementById('disablePopups');
  const popupSettingsStatus = document.getElementById('popupSettingsStatus');
  const scoreboardUsername = document.getElementById('scoreboardUsername');
  const saveUsername = document.getElementById('saveUsername');
  const usernameStatus = document.getElementById('usernameStatus');
  const resetPassword = document.getElementById('resetPassword');
  const passwordStatus = document.getElementById('passwordStatus');
  const returnTo = '/GimkitWeb/settings/';
  settingsSignIn.href = `/GimkitWeb/signIn/?returnTo=${encodeURIComponent(returnTo)}`;

  let authSequence = 0;
  let savedPopupPreference = false;

  disablePopups.addEventListener('change', async () => {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;
    disablePopups.disabled = true;
    popupSettingsStatus.textContent = 'Saving preference...';
    try {
      await db.ref(`users/${user.uid}/settings/disablePopups`).set(disablePopups.checked);
      savedPopupPreference = disablePopups.checked;
      popupSettingsStatus.textContent = disablePopups.checked
        ? 'Automatic popups are disabled.'
        : 'Automatic popups are enabled.';
    } catch (error) {
      console.error('Could not save popup preference:', error);
      disablePopups.checked = savedPopupPreference;
      popupSettingsStatus.textContent = 'Could not save this preference. Try again.';
    } finally {
      disablePopups.disabled = false;
    }
  });

  saveUsername.addEventListener('click', async () => {
    const user = auth.currentUser;
    const username = scoreboardUsername.value.trim();
    if (!user || user.isAnonymous) return;
    if (!username || username.length > 80) {
      usernameStatus.textContent = 'Enter a username up to 80 characters.';
      return;
    }
    saveUsername.disabled = true;
    usernameStatus.textContent = 'Saving username...';
    try {
      await db.ref(`users/${user.uid}/scoreboardUsername`).set(username);
      scoreboardUsername.value = username;
      usernameStatus.textContent = 'Scoreboard username saved.';
    } catch (error) {
      console.error('Could not save scoreboard username:', error);
      usernameStatus.textContent = 'Could not save your username. Try again.';
    } finally {
      saveUsername.disabled = false;
    }
  });

  resetPassword.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user || user.isAnonymous || !user.email) {
      passwordStatus.textContent = 'A signed-in account email is required to reset your password.';
      return;
    }
    resetPassword.disabled = true;
    passwordStatus.textContent = 'Sending password reset email...';
    try {
      await auth.sendPasswordResetEmail(user.email);
      passwordStatus.textContent = `Password reset email sent to ${user.email}.`;
    } catch (error) {
      console.error('Could not send password reset email:', error);
      passwordStatus.textContent = error.code === 'auth/unsupported-first-factor'
        ? 'This account does not have a password to reset.'
        : 'Could not send a password reset email. Check the account email and try again.';
    } finally {
      resetPassword.disabled = false;
    }
  });

  auth.onAuthStateChanged(async user => {
    const sequence = ++authSequence;
    accountSettings.hidden = true;
    signedOutMessage.hidden = true;
    if (!user || user.isAnonymous) {
      accountStatus.textContent = 'You are not signed in.';
      signedOutMessage.hidden = false;
      return;
    }

    accountStatus.textContent = 'Loading account settings...';
    accountIdentity.textContent = `Signed in as ${user.email || 'account'}`;
    try {
      const snapshot = await db.ref(`users/${user.uid}`).once('value');
      if (sequence !== authSequence) return;
      const profile = snapshot.val() || {};
      scoreboardUsername.value = typeof profile.scoreboardUsername === 'string'
        ? profile.scoreboardUsername
        : '';
      savedPopupPreference = Boolean(profile.settings && profile.settings.disablePopups === true);
      disablePopups.checked = savedPopupPreference;
      accountStatus.textContent = '';
      accountSettings.hidden = false;
    } catch (error) {
      if (sequence !== authSequence) return;
      console.error('Could not load account settings:', error);
      accountStatus.textContent = 'Could not load your account settings. Refresh the page and try again.';
    }
  }, error => {
    console.error('Could not check sign-in state:', error);
    accountStatus.textContent = 'Could not check your sign-in state.';
  });
})();
