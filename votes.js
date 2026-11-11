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
  firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const db = firebase.database();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(error => console.error('Could not set authentication persistence:', error));
  const ownerEmail = 'jonathanlam0820@gmail.com';
  const pageStatus = document.getElementById('votePageStatus');
  const proposalSection = document.getElementById('proposalSection');
  const reviewSection = document.getElementById('reviewSection');
  const proposalForm = document.getElementById('proposalForm');
  const proposalStatus = document.getElementById('proposalStatus');
  const proposalList = document.getElementById('proposalList');
  const pollList = document.getElementById('pollList');
  const voteUserInfo = document.getElementById('voteUserInfo');
  const voteSignIn = document.getElementById('voteSignIn');
  const voteSignUp = document.getElementById('voteSignUp');
  const voteSignOut = document.getElementById('voteSignOut');
  const proposalRef = db.ref('voteProposals');
  let currentUser = null;
  let isAdmin = false;
  let isOwner = false;
  let catalog = [];
  let proposals = [];
  let renderSequence = 0;
  let authSequence = 0;
  let proposalListenerAttached = false;
  let pollRefreshTimeout = null;

  function localDateTime(timestamp) {
    const date = new Date(timestamp);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  function parseDateTime(value) {
    return new Date(value).getTime();
  }

  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  function setDefaultTimes() {
    const start = Date.now() + 60 * 60 * 1000;
    document.getElementById('proposalStart').value = localDateTime(start);
    document.getElementById('proposalEnd').value = localDateTime(start + 24 * 60 * 60 * 1000);
  }

  function choicesFromInput(text) {
    const labels = text.split(/\r?\n/).map(choice => choice.trim()).filter(Boolean);
    if (labels.length < 2 || labels.length > 6 || labels.some(choice => choice.length > 100)) {
      throw new Error('Enter 2–6 choices, with no choice longer than 100 characters.');
    }
    return Object.fromEntries(labels.map((label, index) => [String(index + 1), label]));
  }

  function settingsFromProposalForm() {
    const startAt = parseDateTime(document.getElementById('proposalStart').value);
    const endAt = parseDateTime(document.getElementById('proposalEnd').value);
    if (!Number.isFinite(startAt) || startAt <= Date.now() || !Number.isFinite(endAt) || endAt <= startAt) {
      throw new Error('Choose a future start time and an end time after it.');
    }
    return {
      startAt,
      endAt,
      showPopup: document.getElementById('proposalShowPopup').checked,
      announceResults: document.getElementById('proposalAnnounce').checked
    };
  }

  function makeText(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function handleProposalSnapshot(snapshot) {
    proposals = [];
    snapshot.forEach(child => proposals.push({ id: child.key, value: child.val() }));
    renderProposals();
  }

  function handleProposalError(error) {
    console.error('Could not load vote proposals:', error);
    pageStatus.textContent = 'Could not load vote proposals.';
  }

  async function submitProposal(event) {
    event.preventDefault();
    if (!isAdmin || !currentUser) return;
    proposalStatus.textContent = '';
    try {
      const choices = choicesFromInput(document.getElementById('proposalChoices').value);
      const settings = settingsFromProposalForm();
      const proposal = {
        title: document.getElementById('proposalTitle').value.trim(),
        description: document.getElementById('proposalDescription').value.trim(),
        choices,
        settings,
        createdBy: currentUser.uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        status: 'pending'
      };
      if (!proposal.title) throw new Error('Add a question for the vote.');
      await db.ref('voteProposals').push(proposal);
      proposalForm.reset();
      document.getElementById('proposalShowPopup').checked = true;
      document.getElementById('proposalAnnounce').checked = true;
      setDefaultTimes();
      proposalStatus.textContent = 'Proposal sent to the owner for approval.';
    } catch (error) {
      console.error('Could not submit vote proposal:', error);
      proposalStatus.textContent = error.message || 'Could not submit the proposal. Check your connection and try again.';
    }
  }

  function renderProposals() {
    proposalList.replaceChildren();
    const pending = proposals.filter(proposal => proposal.value && proposal.value.status === 'pending');
    if (!pending.length) {
      proposalList.appendChild(makeText('p', 'There are no proposals awaiting approval.', 'small'));
      return;
    }

    pending.forEach(({ id, value }) => {
      const card = document.createElement('article');
      card.className = 'vote-card';
      card.append(
        makeText('h3', value.title || 'Untitled vote'),
        makeText('p', value.description || 'No description provided.', 'small'),
        makeText('p', `Proposed start: ${formatDateTime(value.settings.startAt)} · End: ${formatDateTime(value.settings.endAt)}`, 'small'),
        makeText('p', `Choices: ${Object.values(value.choices || {}).join(' / ')}`, 'small')
      );
      if (isOwner) {
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'primary-button';
        approve.textContent = 'Approve';
        approve.addEventListener('click', () => reviewProposal(id, value, 'approved', approve));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.textContent = 'Reject';
        reject.addEventListener('click', () => reviewProposal(id, value, 'rejected', reject));
        card.append(approve, reject);
      }
      proposalList.appendChild(card);
    });
  }

  async function reviewProposal(id, proposal, status, button) {
    if (!isOwner || !currentUser) return;
    if (status === 'approved' && proposal.settings.startAt <= Date.now()) {
      proposalList.prepend(makeText('p', 'This proposal’s start time has passed. Ask the admin to submit it again with a future start time.', 'small'));
      return;
    }
    button.disabled = true;
    try {
      const updates = {};
      if (status === 'approved') {
        updates[`voteCatalog/${id}`] = {
          title: proposal.title,
          description: proposal.description || '',
          choices: proposal.choices,
          settings: proposal.settings,
          createdAt: proposal.createdAt,
          approvedAt: firebase.database.ServerValue.TIMESTAMP,
          approvedBy: currentUser.uid
        };
      }
      updates[`voteProposals/${id}/status`] = status;
      updates[`voteProposals/${id}/reviewedAt`] = firebase.database.ServerValue.TIMESTAMP;
      updates[`voteProposals/${id}/reviewedBy`] = currentUser.uid;
      await db.ref().update(updates);
    } catch (error) {
      console.error(`Could not ${status} vote proposal:`, error);
      button.disabled = false;
      pageStatus.textContent = 'Could not update the proposal. Check your access and try again.';
    }
  }

  async function savePollSettings(id, poll, form, button) {
    if (!isAdmin || Date.now() >= poll.settings.startAt) return;
    const startAt = parseDateTime(form.elements.startAt.value);
    const endAt = parseDateTime(form.elements.endAt.value);
    if (!Number.isFinite(startAt) || startAt <= Date.now() || !Number.isFinite(endAt) || endAt <= startAt) {
      form.querySelector('[data-settings-status]').textContent = 'Choose a future start time and an end time after it.';
      return;
    }
    button.disabled = true;
    const settings = {
      startAt,
      endAt,
      showPopup: form.elements.showPopup.checked,
      announceResults: form.elements.announceResults.checked
    };
    try {
      await db.ref(`voteCatalog/${id}/settings`).set(settings);
      form.querySelector('[data-settings-status]').textContent = 'Settings saved.';
    } catch (error) {
      console.error('Could not save vote settings:', error);
      form.querySelector('[data-settings-status]').textContent = 'Could not save settings. The vote may have started or you may not have admin access.';
    } finally {
      button.disabled = false;
    }
  }

  function appendAdminSettings(card, id, poll) {
    if (!isAdmin || Date.now() >= poll.settings.startAt) return;
    const section = document.createElement('section');
    section.className = 'admin-settings';
    section.appendChild(makeText('h4', 'Admin settings'));
    const form = document.createElement('form');
    form.className = 'vote-grid';
    form.innerHTML = `
      <label>Start time <input name="startAt" type="datetime-local" required /></label>
      <label>End time <input name="endAt" type="datetime-local" required /></label>
      <label><input name="showPopup" type="checkbox" /> Show opening popup</label>
      <label><input name="announceResults" type="checkbox" /> Publish results after the vote ends</label>
    `;
    form.elements.startAt.value = localDateTime(poll.settings.startAt);
    form.elements.endAt.value = localDateTime(poll.settings.endAt);
    form.elements.showPopup.checked = poll.settings.showPopup === true;
    form.elements.announceResults.checked = poll.settings.announceResults === true;
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save settings';
    const status = makeText('p', '', 'small');
    status.dataset.settingsStatus = '';
    form.addEventListener('submit', event => {
      event.preventDefault();
      savePollSettings(id, poll, form, save);
    });
    form.append(save, status);
    section.appendChild(form);
    card.appendChild(section);
  }

  function appendResults(card, choices, ballots, publicResults) {
    const counts = Object.fromEntries(Object.keys(choices).map(key => [key, 0]));
    let total = 0;
    ballots.forEach(ballot => {
      if (ballot && Object.hasOwn(counts, ballot.choiceId)) {
        counts[ballot.choiceId] += 1;
        total += 1;
      }
    });
    card.appendChild(makeText('h4', publicResults ? 'Final results' : 'Admin results'));
    const list = document.createElement('ol');
    list.className = 'results';
    Object.entries(choices).forEach(([key, label]) => {
      const count = counts[key];
      const percent = total ? Math.round(count * 100 / total) : 0;
      list.appendChild(makeText('li', `${label}: ${count} vote${count === 1 ? '' : 's'} (${percent}%)`));
    });
    card.append(list, makeText('p', `${total} total vote${total === 1 ? '' : 's'}.`, 'small'));
  }

  async function renderPoll(id, poll, generation) {
    const card = document.createElement('article');
    card.className = 'vote-card';
    card.append(
      makeText('h3', poll.title || 'Untitled vote'),
      makeText('p', poll.description || 'No description provided.'),
      makeText('p', `Starts ${formatDateTime(poll.settings.startAt)} · Ends ${formatDateTime(poll.settings.endAt)}`, 'small')
    );
    const now = Date.now();
    const upcoming = now < poll.settings.startAt;
    const ended = now >= poll.settings.endAt;
    card.appendChild(makeText('p', upcoming ? 'Voting has not started yet.' : ended ? 'Voting has ended.' : 'Voting is open.', 'small'));

    let ownBallot = null;
    if (currentUser && !currentUser.isAnonymous) {
      const ballotSnapshot = await db.ref(`voteBallots/${id}/${currentUser.uid}`).once('value');
      ownBallot = ballotSnapshot.val();
    }
    if (generation !== renderSequence) return;

    const choices = poll.choices || {};
    if (!ended && !ownBallot) {
      if (!currentUser || currentUser.isAnonymous) {
        const signIn = document.createElement('a');
        signIn.href = `/GimkitWeb/signIn/?returnTo=${encodeURIComponent('/GimkitWeb/votes/')}`;
        signIn.textContent = 'Sign in to vote';
        card.appendChild(signIn);
      } else {
        const form = document.createElement('form');
        form.setAttribute('aria-label', `Vote in ${poll.title}`);
        const group = `choice-${id}`;
        Object.entries(choices).forEach(([key, label]) => {
          const wrapper = document.createElement('label');
          wrapper.className = 'choice-option';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = group;
          input.value = key;
          input.required = true;
          input.disabled = upcoming;
          wrapper.append(input, document.createTextNode(label));
          form.appendChild(wrapper);
        });
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'primary-button';
        submit.textContent = 'Cast vote';
        submit.disabled = upcoming;
        const status = makeText('p', '', 'small');
        status.setAttribute('role', 'status');
        form.append(submit, status);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const selected = form.querySelector(`input[name="${CSS.escape(group)}"]:checked`);
          if (!selected || !currentUser || currentUser.isAnonymous) return;
          submit.disabled = true;
          try {
            await db.ref(`voteBallots/${id}/${currentUser.uid}`).set({
              choiceId: selected.value,
              votedAt: firebase.database.ServerValue.TIMESTAMP
            });
            await renderPolls();
            schedulePollRefresh();
          } catch (error) {
            console.error('Could not cast vote:', error);
            status.textContent = 'Could not cast your vote. It may have started/ended, or you may already have voted.';
            submit.disabled = false;
          }
        });
        card.appendChild(form);
      }
    } else if (ownBallot && !ended) {
      card.appendChild(makeText('p', 'Your vote is recorded. You can vote once per poll.', 'small'));
    }

    const publicResults = ended && poll.settings.announceResults === true;
    if (ended && (isAdmin || publicResults)) {
      const ballotsSnapshot = await db.ref(`voteBallots/${id}`).once('value');
      if (generation !== renderSequence) return;
      const ballotData = ballotsSnapshot.val() || {};
      appendResults(card, choices, Object.values(ballotData), publicResults);
    } else if (ended) {
      card.appendChild(makeText('p', 'Results are available to admins only.', 'small'));
    }

    appendAdminSettings(card, id, poll);
    pollList.appendChild(card);
  }

  async function renderPolls() {
    const generation = ++renderSequence;
    pollList.replaceChildren();
    if (!catalog.length) {
      pollList.appendChild(makeText('p', 'There are no approved votes yet.', 'small'));
      return;
    }
    catalog.sort((a, b) => a.value.settings.startAt - b.value.settings.startAt);
    for (const { id, value } of catalog) {
      await renderPoll(id, value, generation);
      if (generation !== renderSequence) return;
    }
  }

  function schedulePollRefresh() {
    window.clearTimeout(pollRefreshTimeout);
    const now = Date.now();
    const boundaries = catalog.flatMap(({ value }) => [
      value.settings.startAt,
      value.settings.endAt
    ]).filter(timestamp => timestamp > now);
    if (!boundaries.length) return;
    const delay = Math.min(Math.max(1000, Math.min(...boundaries) - now + 250), 2147483000);
    pollRefreshTimeout = window.setTimeout(() => {
      renderPolls().then(schedulePollRefresh).catch(error => {
        console.error('Could not refresh vote status:', error);
      });
    }, delay);
  }

  function refreshPolls() {
    renderPolls().then(schedulePollRefresh).catch(error => {
      console.error('Could not refresh vote status:', error);
      pageStatus.textContent = 'Could not refresh vote information.';
    });
  }

  voteSignOut.addEventListener('click', () => {
    auth.signOut().catch(error => console.error('Could not sign out:', error));
  });

  proposalForm.addEventListener('submit', submitProposal);
  setDefaultTimes();

  auth.onAuthStateChanged(async user => {
    const sequence = ++authSequence;
    currentUser = user && !user.isAnonymous ? user : null;
    let usernameNeedsAttention = false;
    if (currentUser) {
      try {
        const username = await window.accountUsernames.ensure(currentUser);
        usernameNeedsAttention = !username;
      } catch (error) {
        console.error('Could not verify account username:', error);
        usernameNeedsAttention = true;
      }
      if (sequence !== authSequence) return;
    }
    voteUserInfo.textContent = currentUser ? 'Loading account username...' : '';
    voteSignIn.hidden = Boolean(currentUser);
    voteSignUp.hidden = Boolean(currentUser);
    voteSignOut.hidden = !currentUser;
    isAdmin = false;
    isOwner = Boolean(currentUser && currentUser.emailVerified && currentUser.email &&
      currentUser.email.toLowerCase() === ownerEmail);
    if (currentUser && currentUser.emailVerified && !isOwner) {
      try {
        const snapshot = await db.ref(`admins/${currentUser.uid}`).once('value');
        isAdmin = Boolean(snapshot.val() && snapshot.val().email === currentUser.email.toLowerCase());
      } catch (error) {
        console.error('Could not verify voting admin access:', error);
        pageStatus.textContent = 'Could not verify admin access.';
      }
    } else {
      isAdmin = isOwner;
    }
    if (currentUser) {
      try {
        const usernameSnapshot = await db.ref(`users/${currentUser.uid}/username`).once('value');
        if (sequence !== authSequence) return;
        voteUserInfo.textContent = usernameSnapshot.val() && !usernameNeedsAttention
          ? `Signed in as @${usernameSnapshot.val()}.`
          : 'Username needs attention (visit Settings).';
      } catch (error) {
        console.error('Could not load account username:', error);
        voteUserInfo.textContent = 'Could not load account username.';
      }
    }
    if (sequence !== authSequence) return;
    proposalSection.hidden = !isAdmin;
    reviewSection.hidden = !isAdmin;
    if (isAdmin && !proposalListenerAttached) {
      proposalRef.on('value', handleProposalSnapshot, handleProposalError);
      proposalListenerAttached = true;
    } else if (!isAdmin && proposalListenerAttached) {
      proposalRef.off('value', handleProposalSnapshot);
      proposalListenerAttached = false;
      proposals = [];
      proposalList.replaceChildren();
    }
    refreshPolls();
  });

  db.ref('voteCatalog').on('value', snapshot => {
    catalog = [];
    snapshot.forEach(child => {
      const value = child.val();
      if (value && value.settings && value.choices) catalog.push({ id: child.key, value });
    });
    pageStatus.textContent = catalog.length ? '' : 'There are no approved votes yet.';
    renderPolls().then(schedulePollRefresh).catch(error => {
      console.error('Could not display approved votes:', error);
      pageStatus.textContent = 'Could not load voting information.';
    });
  }, error => {
    console.error('Could not load approved votes:', error);
    pageStatus.textContent = 'Could not load voting information.';
  });

})();
