(() => {
  if (!window.firebase || !firebase.apps.length || !firebase.auth || !firebase.database) return;

  const db = firebase.database();
  const auth = firebase.auth();
  const approvedScoresRef = db.ref('scoreboard/approved');
  const scoreSubmissionForm = document.getElementById('scoreSubmissionForm');
  const reviewSections = Array.from(document.querySelectorAll('[data-score-review]'));
  const ownerEmail = 'jonathanlam0820@gmail.com';
  const gameModes = ['Fishtopia', 'Capture the Flag', 'Tag', 'Knockback', 'Snowbrawl'];
  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 20 });

  function isAllowedGame(game) {
    return gameModes.includes(game);
  }

  function isValidScoreRecord(record) {
    return record &&
      record.status === 'approved' &&
      typeof record.uid === 'string' &&
      typeof record.username === 'string' &&
      isAllowedGame(record.game) &&
      typeof record.score === 'number' &&
      Number.isFinite(record.score) &&
      record.score >= 0;
  }

  function aggregateScores(snapshot) {
    const players = new Map();
    snapshot.forEach(child => {
      const record = child.val();
      if (!isValidScoreRecord(record)) return;
      const player = players.get(record.uid) || {
        uid: record.uid,
        username: record.username || 'Player',
        modeScores: Object.fromEntries(gameModes.map(game => [game, 0])),
        latestAt: 0
      };
      if (record.score > player.modeScores[record.game]) {
        player.modeScores[record.game] = record.score;
      }
      if ((record.approvedAt || record.submittedAt || 0) >= player.latestAt) {
        player.username = record.username || 'Player';
        player.latestAt = record.approvedAt || record.submittedAt || 0;
      }
      player.total = gameModes.reduce((total, game) => total + player.modeScores[game], 0) / gameModes.length;
      players.set(record.uid, player);
    });
    return Array.from(players.values()).sort((a, b) =>
      b.total - a.total || a.username.localeCompare(b.username)
    );
  }

  function renderLeaderboard(container, players, limit) {
    if (!container) return;
    container.replaceChildren();
    const entries = typeof limit === 'number' ? players.slice(0, limit) : players;
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No approved scores yet.';
      container.appendChild(empty);
      return;
    }
    entries.forEach((player, index) => {
      const item = document.createElement('li');
      item.textContent = `${index + 1}. ${player.username} — Total: ${numberFormat.format(player.total)} points`;
      if (typeof limit !== 'number') {
        const details = document.createElement('ul');
        details.className = 'score-details';
        gameModes.forEach(game => {
          const detail = document.createElement('li');
          detail.textContent = `${game}: ${numberFormat.format(player.modeScores[game])} points`;
          details.appendChild(detail);
        });
        item.appendChild(details);
      }
      container.appendChild(item);
    });
  }

  function renderPublicScoreboard(snapshot) {
    const players = aggregateScores(snapshot);
    renderLeaderboard(document.getElementById('homeScoreboardList'), players, 5);
    renderLeaderboard(document.getElementById('scoreboardList'), players);
  }

  approvedScoresRef.on('value', renderPublicScoreboard, error => {
    console.error('Could not load approved scores:', error);
    ['homeScoreboardList', 'scoreboardList'].forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      container.replaceChildren();
      const message = document.createElement('li');
      message.textContent = 'The scoreboard is temporarily unavailable.';
      container.appendChild(message);
    });
  });

  const scoreUserInfo = document.getElementById('scoreUserInfo');
  const scoreSignInLink = document.getElementById('scoreSignInLink');
  const scoreSignUpLink = document.getElementById('scoreSignUpLink');
  const scoreSignOut = document.getElementById('scoreSignOut');
  const scoreSubmissionAccess = document.getElementById('scoreSubmissionAccess');
  const scoreSubmissionStatus = document.getElementById('scoreSubmissionStatus');
  const myScoreSubmissions = document.getElementById('myScoreSubmissions');
  const scoreGameInput = document.getElementById('scoreGameInput');
  const scoreValueInput = document.getElementById('scoreValueInput');
  const scoreSubmitButton = document.getElementById('scoreSubmitButton');
  let activeUserUid = null;
  let authStateChangeId = 0;

  function renderMySubmissions(snapshot) {
    if (!myScoreSubmissions) return;
    myScoreSubmissions.replaceChildren();
    const entries = [];
    snapshot.forEach(child => {
      const record = child.val();
      if (record && typeof record.game === 'string' && typeof record.score === 'number') {
        entries.push({ ...record, key: child.key });
      }
    });
    entries.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'You have not submitted any scores yet.';
      myScoreSubmissions.appendChild(empty);
      return;
    }
    entries.forEach(entry => {
      const item = document.createElement('li');
      item.textContent = `${entry.game}: ${numberFormat.format(entry.score)} points — ${entry.status || 'pending'}`;
      myScoreSubmissions.appendChild(item);
    });
  }

  function watchMySubmissions(user) {
    if (!myScoreSubmissions) return;
    if (!user || !user.emailVerified || user.isAnonymous) {
      if (activeUserUid) db.ref(`scoreSubmissions/${activeUserUid}`).off('value', renderMySubmissions);
      activeUserUid = null;
      myScoreSubmissions.replaceChildren();
      const message = document.createElement('li');
      message.textContent = 'Sign in with a verified account to view your submissions.';
      myScoreSubmissions.appendChild(message);
      return;
    }
    if (activeUserUid === user.uid) return;
    if (activeUserUid) db.ref(`scoreSubmissions/${activeUserUid}`).off('value', renderMySubmissions);
    activeUserUid = user.uid;
    db.ref(`scoreSubmissions/${user.uid}`).on('value', renderMySubmissions, error => {
      console.error('Could not load your score submissions:', error);
      if (activeUserUid === user.uid) {
        myScoreSubmissions.replaceChildren();
        const message = document.createElement('li');
        message.textContent = 'Could not load your submissions.';
        myScoreSubmissions.appendChild(message);
      }
    });
  }

  if (scoreSignInLink && scoreSignUpLink) {
    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    scoreSignInLink.href = `/GimkitWeb/signIn/?returnTo=${encodeURIComponent(returnTo)}`;
    scoreSignUpLink.href = `/GimkitWeb/signUp/?returnTo=${encodeURIComponent(returnTo)}`;
  }

  if (scoreSignOut) {
    scoreSignOut.addEventListener('click', () => {
      auth.signOut().catch(error => console.error('Scoreboard sign-out failed:', error));
    });
  }

  if (scoreSubmissionForm) {
    scoreSubmissionForm.addEventListener('submit', async event => {
      event.preventDefault();
      const user = auth.currentUser;
      if (!user || user.isAnonymous || !user.emailVerified) {
        scoreSubmissionStatus.textContent = 'Sign in with a verified account before submitting.';
        return;
      }
      const game = scoreGameInput.value.trim();
      const score = Number(scoreValueInput.value);
      if (!isAllowedGame(game) || scoreValueInput.value.trim() === '' ||
          !Number.isFinite(score) || score < 0 || score > 1000000000) {
        scoreSubmissionStatus.textContent = 'Select one of the five game modes and enter a score from 0 to 1,000,000,000.';
        return;
      }

      scoreSubmitButton.disabled = true;
      scoreSubmissionStatus.textContent = 'Submitting score for review…';
      try {
        await user.reload();
        if (!auth.currentUser || auth.currentUser.uid !== user.uid || !auth.currentUser.emailVerified) {
          scoreSubmissionStatus.textContent = 'Verify your email address before submitting a score.';
          return;
        }
        await auth.currentUser.getIdToken(true);
        const submission = {
          uid: user.uid,
          username: (user.displayName || 'Player').slice(0, 80),
          game,
          score,
          submittedAt: Date.now(),
          status: 'pending'
        };
        await db.ref(`scoreSubmissions/${user.uid}`).push().set(submission);
        scoreSubmissionForm.reset();
        scoreSubmissionStatus.textContent = 'Score submitted. It will appear on the public scoreboard after approval.';
      } catch (error) {
        console.error('Could not submit score:', error);
        scoreSubmissionStatus.textContent = 'Could not submit your score. Confirm your email is verified and try again.';
      } finally {
        scoreSubmitButton.disabled = false;
      }
    });
  }

  async function canReviewScores(user) {
    if (!user || user.isAnonymous || !user.emailVerified || !user.email) return false;
    if (user.email.toLowerCase() === ownerEmail) return true;
    try {
      const snapshot = await db.ref(`admins/${user.uid}`).once('value');
      const admin = snapshot.val();
      return Boolean(admin && admin.email === user.email.toLowerCase());
    } catch (error) {
      console.error('Could not verify score-review access:', error);
      return false;
    }
  }

  function renderPendingSubmissions(snapshot, section) {
    const list = section.querySelector('[data-score-review-list]');
    const status = section.querySelector('[data-score-review-status]');
    list.replaceChildren();
    const pending = [];
    snapshot.forEach(userSnapshot => {
      userSnapshot.forEach(submissionSnapshot => {
        const record = submissionSnapshot.val();
        if (record && record.status === 'pending' && typeof record.game === 'string' && typeof record.score === 'number') {
          pending.push({
            uid: userSnapshot.key,
            key: submissionSnapshot.key,
            ...record
          });
        }
      });
    });
    pending.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    status.textContent = pending.length
      ? `${pending.length} score${pending.length === 1 ? '' : 's'} awaiting review.`
      : 'No score submissions are awaiting review.';

    pending.forEach(submission => {
      const item = document.createElement('li');
      const details = document.createElement('span');
      details.textContent = `${submission.username || 'Player'} (${submission.uid.slice(0, 8)}) — ${submission.game}: ${numberFormat.format(submission.score)} points`;
      const actions = document.createElement('span');
      const approveButton = document.createElement('button');
      approveButton.type = 'button';
      approveButton.textContent = 'Approve';
      approveButton.disabled = !isAllowedGame(submission.game);
      if (!isAllowedGame(submission.game)) {
        details.textContent += ' — unsupported game mode; reject this submission';
      }
      const rejectButton = document.createElement('button');
      rejectButton.type = 'button';
      rejectButton.textContent = 'Reject';

      approveButton.addEventListener('click', async () => {
        if (!isAllowedGame(submission.game)) return;
        approveButton.disabled = true;
        rejectButton.disabled = true;
        const approvedAt = Date.now();
        const updates = {};
        updates[`scoreSubmissions/${submission.uid}/${submission.key}/status`] = 'approved';
        updates[`scoreboard/approved/${submission.key}`] = {
          uid: submission.uid,
          username: submission.username || 'Player',
          game: submission.game,
          score: submission.score,
          submittedAt: submission.submittedAt || approvedAt,
          approvedAt,
          status: 'approved'
        };
        try {
          await db.ref().update(updates);
        } catch (error) {
          console.error('Could not approve score submission:', error);
          status.textContent = 'Could not approve that submission. Check the database rules and try again.';
          approveButton.disabled = false;
          rejectButton.disabled = false;
        }
      });

      rejectButton.addEventListener('click', async () => {
        approveButton.disabled = true;
        rejectButton.disabled = true;
        try {
          await db.ref(`scoreSubmissions/${submission.uid}/${submission.key}/status`).set('rejected');
        } catch (error) {
          console.error('Could not reject score submission:', error);
          status.textContent = 'Could not reject that submission. Check the database rules and try again.';
          approveButton.disabled = false;
          rejectButton.disabled = false;
        }
      });
      actions.append(approveButton, rejectButton);
      item.append(details, actions);
      list.appendChild(item);
    });
  }

  function initializeScoreReview(section) {
    let reviewAuthStateChangeId = 0;
    let reviewUid = null;
    let reviewRef = null;
    let reviewListener = null;
    const status = section.querySelector('[data-score-review-status]');
    function detachReviewListener() {
      if (reviewRef && reviewListener) reviewRef.off('value', reviewListener);
      reviewUid = null;
      reviewRef = null;
      reviewListener = null;
    }

    auth.onAuthStateChanged(async user => {
      const currentStateId = ++reviewAuthStateChangeId;
      section.hidden = true;
      if (!user || user.isAnonymous) {
        detachReviewListener();
        return;
      }
      if (reviewUid && reviewUid !== user.uid) detachReviewListener();
      const allowed = await canReviewScores(user);
      if (currentStateId !== reviewAuthStateChangeId) return;
      if (!allowed) {
        detachReviewListener();
        if (user && user.emailVerified && !user.isAnonymous) {
          status.textContent = 'Could not verify score-review access.';
        }
        return;
      }
      section.hidden = false;
      if (reviewUid === user.uid) return;
      reviewUid = user.uid;
      reviewRef = db.ref('scoreSubmissions');
      reviewListener = snapshot => {
        renderPendingSubmissions(snapshot, section);
      };
      reviewRef.on('value', reviewListener, error => {
        console.error('Could not load score submissions for review:', error);
        status.textContent = 'Could not load score submissions. Check the database rules and try again.';
      });
    });
  }

  reviewSections.forEach(initializeScoreReview);

  if (scoreSubmissionForm || scoreUserInfo || scoreSignInLink || scoreSignUpLink || myScoreSubmissions) {
    auth.onAuthStateChanged(async user => {
      const stateChangeId = ++authStateChangeId;
      if (user && !user.isAnonymous && user.email) {
        scoreUserInfo.textContent = `Signed in as ${user.displayName || user.email}`;
        scoreSignInLink.hidden = true;
        scoreSignUpLink.hidden = true;
        scoreSignOut.hidden = false;
      } else {
        scoreUserInfo.textContent = '';
        scoreSignInLink.hidden = false;
        scoreSignUpLink.hidden = false;
        scoreSignOut.hidden = true;
      }

      watchMySubmissions(user);
      if (scoreSubmissionForm) {
        scoreSubmissionForm.hidden = true;
        scoreSubmissionAccess.textContent = user && !user.isAnonymous && !user.emailVerified
          ? 'Verify your email address before submitting a score.'
          : 'Sign in with a verified account to submit a score.';
      }
      if (!user || user.isAnonymous) return;

      try {
        await user.reload();
      } catch (error) {
        console.error('Could not refresh account verification status:', error);
        if (scoreSubmissionAccess) {
          scoreSubmissionAccess.textContent = 'Could not verify your account. Refresh the page and try again.';
        }
        return;
      }
      if (stateChangeId !== authStateChangeId) return;
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.uid === user.uid && currentUser.emailVerified) {
        if (scoreSubmissionForm) {
          scoreSubmissionForm.hidden = false;
          scoreSubmissionAccess.textContent = 'Your submission will remain private until approved.';
        }
        watchMySubmissions(currentUser);
      } else if (scoreSubmissionAccess) {
        scoreSubmissionAccess.textContent = 'Verify your email address before submitting a score.';
      }
    });
  }
})();
