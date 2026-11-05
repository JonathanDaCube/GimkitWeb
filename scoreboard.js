(() => {
  if (!window.firebase || !firebase.apps.length || !firebase.auth || !firebase.database) return;

  const db = firebase.database();
  const auth = firebase.auth();
  const eloMatchesRef = db.ref('eloMatches');
  const matchSubmissionRoot = db.ref('matchSubmissions');
  const scoreSubmissionForm = document.getElementById('scoreSubmissionForm');
  const reviewSections = Array.from(document.querySelectorAll('[data-score-review]'));
  const ownerEmail = 'jonathanlam0820@gmail.com';
  const gameModes = ['Fishtopia', 'Capture the Flag', 'Tag', 'Knockback', 'Snowbrawl', 'Dont Look Down'];
  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 20 });

  function isAllowedGame(game) {
    return gameModes.includes(game);
  }

  function isValidMatchPlayers(playerRecords) {
    const players = playerRecords ? Object.values(playerRecords) : [];
    if (players.length < 2 || players.length > 20) return false;
    const seenPlayers = new Set();
    return players.every(player => {
      if (!player ||
          typeof player.username !== 'string' ||
          !player.username.trim() ||
          player.username.trim().length > 80 ||
          !Number.isInteger(player.place) ||
          player.place < 1 ||
          player.place > players.length) {
        return false;
      }
      const key = playerKey(player.username);
      if (seenPlayers.has(key)) return false;
      seenPlayers.add(key);
      return true;
    }) && players.some(player => player.place === 1);
  }

  function isValidMatchRecord(record) {
    return record &&
      record.status === 'approved' &&
      isAllowedGame(record.game) &&
      isValidMatchPlayers(record.players);
  }

  function playerKey(username) {
    const normalized = username.trim().toLocaleLowerCase();
    return Array.from(new TextEncoder().encode(normalized), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function aggregateRatings(snapshot) {
    const matches = [];
    snapshot.forEach(child => {
      const record = child.val();
      if (isValidMatchRecord(record)) matches.push(record);
    });
    matches.sort((a, b) => (a.approvedAt || 0) - (b.approvedAt || 0));

    const players = new Map();
    matches.forEach(match => {
      const entrants = [];
      const seenPlayers = new Set();
      Object.values(match.players).forEach(result => {
        const key = playerKey(result.username);
        if (seenPlayers.has(key)) return;
        seenPlayers.add(key);
        const player = players.get(key) || {
          key,
          username: result.username.trim(),
          modeScores: Object.fromEntries(gameModes.map(game => [game, 50])),
          scoredModes: Object.fromEntries(gameModes.map(game => [game, false])),
          latestAt: 0
        };
        player.username = result.username.trim();
        entrants.push({ key, place: result.place, rating: player.modeScores[match.game] });
        players.set(key, player);
      });

      if (entrants.length < 2) return;
      const deltas = new Map();
      entrants.forEach(entrant => {
        let expected = 0;
        let actual = 0;
        entrants.forEach(opponent => {
          if (entrant === opponent) return;
          expected += 1 / (1 + Math.pow(10, (opponent.rating - entrant.rating) / 400));
          actual += entrant.place < opponent.place ? 1 : entrant.place === opponent.place ? 0.5 : 0;
        });
        const difference = (actual - expected) / (entrants.length - 1);
        deltas.set(entrant.key, Math.max(-2, Math.min(8, difference * 8)));
      });
      entrants.forEach(entrant => {
        const player = players.get(entrant.key);
        player.scoredModes[match.game] = true;
        player.latestAt = Math.max(player.latestAt, match.approvedAt || 0);
        player.modeScores[match.game] = Math.max(0, player.modeScores[match.game] + deltas.get(entrant.key));
      });
    });

    players.forEach(player => {
      player.total = gameModes.reduce((total, game) => total + player.modeScores[game], 0) / gameModes.length;
    });
    return Array.from(players.values()).sort((a, b) =>
      b.total - a.total || a.username.localeCompare(b.username)
    );
  }

  function renderLeaderboard(container, players, scoreMode, limit) {
    if (!container) return;
    container.replaceChildren();
    const rankedPlayers = scoreMode
      ? players.filter(player => player.scoredModes[scoreMode])
        .sort((a, b) => b.modeScores[scoreMode] - a.modeScores[scoreMode] || a.username.localeCompare(b.username))
      : players;
    const entries = typeof limit === 'number' ? rankedPlayers.slice(0, limit) : rankedPlayers;
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No approved match results yet.';
      container.appendChild(empty);
      return;
    }
    entries.forEach((player, index) => {
      const item = document.createElement('li');
      const rating = scoreMode ? player.modeScores[scoreMode] : player.total;
      item.textContent = `${index + 1}. ${player.username} — ${numberFormat.format(rating)} Elo`;
      container.appendChild(item);
    });
  }

  function renderPublicScoreboard(snapshot) {
    const players = aggregateRatings(snapshot);
    latestPlayers = players;
    renderSkillChart();
    renderLeaderboard(document.getElementById('homeScoreboardList'), players, null, 5);
    renderLeaderboard(document.getElementById('scoreboardTotalList'), players, null);
    gameModes.forEach(game => {
      renderLeaderboard(document.getElementById(`scoreboard${game.replaceAll(' ', '')}List`), players, game);
    });
  }

  const scoreUserInfo = document.getElementById('scoreUserInfo');
  const scoreSignInLink = document.getElementById('scoreSignInLink');
  const scoreSignUpLink = document.getElementById('scoreSignUpLink');
  const scoreSignOut = document.getElementById('scoreSignOut');
  const scoreSubmissionAccess = document.getElementById('scoreSubmissionAccess');
  const scoreSubmissionStatus = document.getElementById('scoreSubmissionStatus');
  const myScoreSubmissions = document.getElementById('myScoreSubmissions');
  const scoreGameInput = document.getElementById('scoreGameInput');
  const scoreSubmitButton = document.getElementById('scoreSubmitButton');
  const matchPlayers = document.getElementById('matchPlayers');
  const addMatchPlayerButton = document.getElementById('addMatchPlayer');
  const skillRadar = document.getElementById('skillRadar');
  const skillRadarGrid = document.getElementById('skillRadarGrid');
  const skillArea = document.getElementById('skillArea');
  const skillTotalValue = document.getElementById('skillTotalValue');
  const skillChartStatus = document.getElementById('skillChartStatus');
  const skillModeValues = document.getElementById('skillModeValues');
  let activeUserUid = null;
  let authStateChangeId = 0;
  let skillPlayerKey = null;
  let latestPlayers = [];

  initializeSkillRadar();

  eloMatchesRef.on('value', renderPublicScoreboard, error => {
    console.error('Could not load approved match results:', error);
    ['homeScoreboardList', 'scoreboardTotalList', ...gameModes.map(game => `scoreboard${game.replaceAll(' ', '')}List`)].forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      container.replaceChildren();
      const message = document.createElement('li');
      message.textContent = 'The scoreboard is temporarily unavailable.';
      container.appendChild(message);
    });
    if (skillChartStatus) skillChartStatus.textContent = 'The Elo chart is temporarily unavailable.';
    if (skillRadar) skillRadar.hidden = true;
  });

  function skillChartPoint(value, index, radius) {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / gameModes.length;
    const distance = radius * value / 100;
    return `${180 + Math.cos(angle) * distance},${155 + Math.sin(angle) * distance}`;
  }

  function initializeSkillRadar() {
    if (!skillRadarGrid) return;
    skillRadarGrid.replaceChildren();
    [20, 40, 60, 80, 100].forEach(level => {
      const grid = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      grid.setAttribute('class', 'skill-grid');
      grid.setAttribute('points', gameModes.map((_, index) => skillChartPoint(level, index, 90)).join(' '));
      skillRadarGrid.appendChild(grid);
    });
    gameModes.forEach((game, index) => {
      const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const endpoint = skillChartPoint(100, index, 90).split(',').map(Number);
      axis.setAttribute('class', 'skill-axis');
      axis.setAttribute('x1', '180');
      axis.setAttribute('y1', '155');
      axis.setAttribute('x2', String(endpoint[0]));
      axis.setAttribute('y2', String(endpoint[1]));
      skillRadarGrid.appendChild(axis);

      const angle = -Math.PI / 2 + (2 * Math.PI * index) / gameModes.length;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'skill-label');
      label.setAttribute('x', String(180 + Math.cos(angle) * 112));
      label.setAttribute('y', String(155 + Math.sin(angle) * 112 + 4));
      label.setAttribute('text-anchor', Math.cos(angle) < -0.25 ? 'end' : Math.cos(angle) > 0.25 ? 'start' : 'middle');
      label.textContent = game;
      skillRadarGrid.appendChild(label);
    });
  }

  function renderSkillChart() {
    if (!skillRadar || !skillChartStatus || !skillArea || !skillTotalValue || !skillModeValues) return;
    if (!skillPlayerKey) {
      skillRadar.hidden = true;
      skillModeValues.replaceChildren();
      skillChartStatus.textContent = 'Sign in to see your skill chart.';
      return;
    }

    const player = latestPlayers.find(entry => entry.key === skillPlayerKey);
    const modeScores = player ? player.modeScores : Object.fromEntries(gameModes.map(game => [game, 50]));
    const modeBestScores = Object.fromEntries(gameModes.map(game => [
      game,
      latestPlayers.reduce((best, entry) => Math.max(best, entry.modeScores[game]), 0)
    ]));
    const normalizedScores = gameModes.map(game => {
      const best = modeBestScores[game];
      return best > 0 ? Math.min(100, (modeScores[game] / best) * 100) : 0;
    });
    const averageElo = gameModes.reduce((total, game) => total + modeScores[game], 0) / gameModes.length;

    skillArea.setAttribute('points', normalizedScores.map((score, index) => skillChartPoint(score, index, 90)).join(' '));
    skillTotalValue.textContent = String(Math.round(averageElo));
    skillRadar.hidden = false;
    skillChartStatus.textContent = 'The radar compares each of your mode ratings with the highest rating in that mode.';
    skillModeValues.replaceChildren();
    gameModes.forEach((game, index) => {
      const item = document.createElement('li');
      item.textContent = `${game}: ${numberFormat.format(modeScores[game])} Elo (${Math.round(normalizedScores[index])}/100)`;
      skillModeValues.appendChild(item);
    });
  }

  function renderMySubmissions(snapshot) {
    if (!myScoreSubmissions) return;
    myScoreSubmissions.replaceChildren();
    const entries = [];
    snapshot.forEach(child => {
      const record = child.val();
      if (record && typeof record.game === 'string' && record.players) {
        entries.push({ ...record, key: child.key });
      }
    });
    entries.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'You have not submitted any matches yet.';
      myScoreSubmissions.appendChild(empty);
      return;
    }
    entries.forEach(entry => {
      const item = document.createElement('li');
      const roster = Object.values(entry.players || {})
        .sort((a, b) => a.place - b.place)
        .map(player => `${player.place}. ${player.username}`)
        .join(', ');
      item.textContent = `${entry.game}: ${roster} — ${entry.status || 'pending'}`;
      myScoreSubmissions.appendChild(item);
    });
  }

  function watchMySubmissions(user) {
    if (!myScoreSubmissions) return;
    if (!user || !user.emailVerified || user.isAnonymous) {
      if (activeUserUid) matchSubmissionRoot.child(activeUserUid).off('value', renderMySubmissions);
      activeUserUid = null;
      myScoreSubmissions.replaceChildren();
      const message = document.createElement('li');
      message.textContent = 'Sign in with a verified account to view your match submissions.';
      myScoreSubmissions.appendChild(message);
      return;
    }
    if (activeUserUid === user.uid) return;
    if (activeUserUid) matchSubmissionRoot.child(activeUserUid).off('value', renderMySubmissions);
    activeUserUid = user.uid;
    matchSubmissionRoot.child(user.uid).on('value', renderMySubmissions, error => {
      console.error('Could not load your match submissions:', error);
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
    function updatePlayerRowControls() {
      const rows = Array.from(matchPlayers.querySelectorAll('.match-player'));
      rows.forEach(row => {
        row.querySelector('[data-remove-player]').hidden = rows.length <= 2;
      });
      addMatchPlayerButton.disabled = rows.length >= 20;
    }

    addMatchPlayerButton.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'match-player';
      row.innerHTML = `
        <label>Player username <input type="text" data-player-name maxlength="80" required /></label>
        <label>Finishing place <input type="number" data-player-place min="1" max="20" step="1" required /></label>
        <button type="button" data-remove-player>Remove player</button>
      `;
      row.querySelector('[data-remove-player]').addEventListener('click', () => {
        row.remove();
        updatePlayerRowControls();
      });
      matchPlayers.appendChild(row);
      updatePlayerRowControls();
      row.querySelector('[data-player-name]').focus();
    });

    matchPlayers.querySelectorAll('[data-remove-player]').forEach(button => {
      button.addEventListener('click', () => {
        button.closest('.match-player').remove();
        updatePlayerRowControls();
      });
    });
    updatePlayerRowControls();

    scoreSubmissionForm.addEventListener('submit', async event => {
      event.preventDefault();
      const user = auth.currentUser;
      if (!user || user.isAnonymous || !user.emailVerified) {
        scoreSubmissionStatus.textContent = 'Sign in with a verified account before submitting.';
        return;
      }
      const game = scoreGameInput.value.trim();
      const rows = Array.from(matchPlayers.querySelectorAll('.match-player'));
      const players = rows.map(row => ({
        username: row.querySelector('[data-player-name]').value.trim(),
        place: Number(row.querySelector('[data-player-place]').value)
      }));
      const normalizedNames = players.map(player => player.username.toLocaleLowerCase());
      const submitterUsername = (user.displayName || 'Player').trim();
      if (!isAllowedGame(game) || players.length < 2 || players.length > 20 ||
          players.some(player => !player.username || player.username.length > 80 ||
            !Number.isInteger(player.place) || player.place < 1 || player.place > players.length) ||
          new Set(normalizedNames).size !== normalizedNames.length ||
          !players.some(player => player.username.toLocaleLowerCase() === submitterUsername.toLocaleLowerCase()) ||
          !players.some(player => player.place === 1)) {
        scoreSubmissionStatus.textContent = `Select a game mode and enter 2–20 unique player usernames, including your own (${submitterUsername}), with valid finishing places and a first-place result.`;
        return;
      }

      scoreSubmitButton.disabled = true;
      scoreSubmissionStatus.textContent = 'Submitting match for review…';
      try {
        await user.reload();
        if (!auth.currentUser || auth.currentUser.uid !== user.uid || !auth.currentUser.emailVerified) {
          scoreSubmissionStatus.textContent = 'Verify your email address before submitting a match.';
          return;
        }
        await auth.currentUser.getIdToken(true);
        const submission = {
          submitterUid: user.uid,
          game,
          players: Object.fromEntries(players.map((player, index) => [String(index + 1), player])),
          submittedAt: Date.now(),
          status: 'pending'
        };
        await matchSubmissionRoot.child(user.uid).push().set(submission);
        scoreSubmissionForm.reset();
        matchPlayers.querySelectorAll('.match-player').forEach(row => row.remove());
        matchPlayers.appendChild(createPlayerRow(submitterUsername));
        matchPlayers.appendChild(createPlayerRow());
        updatePlayerRowControls();
        scoreSubmissionStatus.textContent = 'Match submitted. Elo ratings will update after admin approval.';
      } catch (error) {
        console.error('Could not submit match:', error);
        scoreSubmissionStatus.textContent = 'Could not submit your match. Confirm your email is verified and try again.';
      } finally {
        scoreSubmitButton.disabled = false;
      }
    });
  }

  function createPlayerRow(username = '') {
    const row = document.createElement('div');
    row.className = 'match-player';
    row.innerHTML = `
      <label>Player username <input type="text" data-player-name maxlength="80" required /></label>
      <label>Finishing place <input type="number" data-player-place min="1" max="20" step="1" required /></label>
      <button type="button" data-remove-player>Remove player</button>
    `;
    row.querySelector('[data-player-name]').value = username;
    row.querySelector('[data-remove-player]').addEventListener('click', () => {
      row.remove();
      const rows = Array.from(matchPlayers.querySelectorAll('.match-player'));
      rows.forEach(currentRow => {
        currentRow.querySelector('[data-remove-player]').hidden = rows.length <= 2;
      });
      addMatchPlayerButton.disabled = rows.length >= 20;
    });
    return row;
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
        if (record && record.status === 'pending' && isAllowedGame(record.game) && record.players) {
          pending.push({
            uid: userSnapshot.key,
            key: submissionSnapshot.key,
            ...record
          });
        }
      });
    });
    pending.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    section.hidden = pending.length === 0;
    status.textContent = pending.length
      ? `${pending.length} match${pending.length === 1 ? '' : 'es'} awaiting review.`
      : 'No match submissions are awaiting review.';

    pending.forEach(submission => {
      const item = document.createElement('li');
      const details = document.createElement('span');
      const roster = Object.values(submission.players)
        .sort((a, b) => a.place - b.place)
        .map(player => `${player.place}. ${player.username}`)
        .join(', ');
      details.textContent = `${submission.game} — ${roster} (submitted by ${submission.uid.slice(0, 8)})`;
      const actions = document.createElement('span');
      const approveButton = document.createElement('button');
      approveButton.type = 'button';
      approveButton.textContent = 'Approve';
      const validRoster = isValidMatchPlayers(submission.players);
      approveButton.disabled = !validRoster;
      if (!validRoster) details.textContent += ' — invalid roster; reject this submission';
      const rejectButton = document.createElement('button');
      rejectButton.type = 'button';
      rejectButton.textContent = 'Reject';

      approveButton.addEventListener('click', async () => {
        if (!validRoster) return;
        approveButton.disabled = true;
        rejectButton.disabled = true;
        const approvedAt = Date.now();
        const approvedMatch = {
          game: submission.game,
          players: submission.players,
          submitterUid: submission.submitterUid,
          submittedAt: submission.submittedAt || approvedAt,
          approvedAt,
          approvedBy: auth.currentUser.uid,
          status: 'approved'
        };
        try {
          const resultRef = eloMatchesRef.child(submission.key);
          const transaction = await resultRef.transaction(current => current ? undefined : approvedMatch);
          if (!transaction.committed &&
              transaction.snapshot.val()?.submitterUid !== submission.submitterUid) {
            throw new Error('A different approved match already uses this result ID.');
          }
          await matchSubmissionRoot.child(submission.uid).child(submission.key).update({
            status: 'approved',
            approvedAt,
            approvedBy: auth.currentUser.uid
          });
        } catch (error) {
          console.error('Could not approve match submission:', error);
          status.textContent = 'Could not approve that match. Check the database rules and try again.';
          approveButton.disabled = false;
          rejectButton.disabled = false;
        }
      });

      rejectButton.addEventListener('click', async () => {
        approveButton.disabled = true;
        rejectButton.disabled = true;
        try {
          await matchSubmissionRoot.child(submission.uid).child(submission.key).update({
            status: 'rejected',
            reviewedAt: Date.now(),
            reviewedBy: auth.currentUser.uid
          });
        } catch (error) {
          console.error('Could not reject match submission:', error);
          status.textContent = 'Could not reject that match. Check the database rules and try again.';
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
      if (reviewUid === user.uid) return;
      reviewUid = user.uid;
      reviewRef = matchSubmissionRoot;
      reviewListener = snapshot => {
        renderPendingSubmissions(snapshot, section);
      };
      reviewRef.on('value', reviewListener, error => {
        console.error('Could not load match submissions for review:', error);
        status.textContent = 'Could not load match submissions. Check the database rules and try again.';
      });
    });
  }

  reviewSections.forEach(initializeScoreReview);

  if (scoreSubmissionForm || scoreUserInfo || scoreSignInLink || scoreSignUpLink || myScoreSubmissions) {
    auth.onAuthStateChanged(async user => {
      const stateChangeId = ++authStateChangeId;
      skillPlayerKey = user && !user.isAnonymous ? playerKey(user.displayName || 'Player') : null;
      renderSkillChart();
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
          ? 'Verify your email address before submitting a match.'
          : 'Sign in with a verified account to submit a match.';
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
          scoreSubmissionAccess.textContent = 'Your match stays private until an admin approves it.';
          matchPlayers.querySelector('[data-player-name]').value = currentUser.displayName || 'Player';
        }
        watchMySubmissions(currentUser);
      } else if (scoreSubmissionAccess) {
        scoreSubmissionAccess.textContent = 'Verify your email address before submitting a match.';
      }
    });
  }
})();
