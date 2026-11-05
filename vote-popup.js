(() => {
  if (!window.firebase || !firebase.apps.length) return;

  const popup = document.getElementById('votePopup');
  const title = document.getElementById('votePopupTitle');
  const description = document.getElementById('votePopupDescription');
  const prompt = document.getElementById('votePopupPrompt');
  const dismiss = document.getElementById('dismissVotePopup');
  if (!popup || !title || !description || !prompt || !dismiss) return;

  let currentUser = null;
  let authReady = false;
  let polls = [];
  let checkSequence = 0;

  dismiss.addEventListener('click', () => popup.close());

  async function checkForOpenVote() {
    if (!authReady || popup.open) return;
    const sequence = ++checkSequence;
    const now = Date.now();
    const active = polls
      .filter(({ value }) => value.settings &&
        value.settings.showPopup !== false &&
        value.settings.startAt <= now &&
        value.settings.endAt > now)
      .sort((a, b) => a.value.settings.endAt - b.value.settings.endAt);

    if (active.length) {
      for (const { id, value } of active) {
        const key = `vote-popup-dismissed-active-${id}`;
        try {
          if (sessionStorage.getItem(key)) continue;
        } catch (error) {
          console.warn('Could not read vote popup session state:', error);
        }
        if (currentUser && !currentUser.isAnonymous) {
          try {
            const ballot = await firebase.database().ref(`voteBallots/${id}/${currentUser.uid}`).once('value');
            if (ballot.exists()) continue;
          } catch (error) {
            console.error('Could not check whether the user voted:', error);
            continue;
          }
        }
        if (sequence !== checkSequence) return;
        title.textContent = value.title || 'Community vote';
        description.textContent = value.description || 'A community vote is open now.';
        prompt.textContent = currentUser && !currentUser.isAnonymous
          ? 'Your vote is open now. Visit the Voting page to choose an option.'
          : 'Sign in to cast your vote.';
        try {
          sessionStorage.setItem(key, '1');
        } catch (error) {
          console.warn('Could not save vote popup session state:', error);
        }
        popup.showModal();
        return;
      }
    }

    const completed = polls
      .filter(({ value }) => value.settings &&
        value.settings.showPopup !== false &&
        value.settings.announceResults === true &&
        value.settings.endAt <= now)
      .sort((a, b) => b.value.settings.endAt - a.value.settings.endAt)
      .slice(0, 1);
    for (const { id, value } of completed) {
      const key = `vote-popup-dismissed-results-${id}`;
      try {
        if (sessionStorage.getItem(key)) continue;
      } catch (error) {
        console.warn('Could not read vote result popup session state:', error);
      }
      let ballots;
      try {
        const snapshot = await firebase.database().ref(`voteBallots/${id}`).once('value');
        ballots = snapshot.val() || {};
      } catch (error) {
        console.error('Could not load announced vote results:', error);
        continue;
      }
      if (sequence !== checkSequence) return;
      const counts = Object.fromEntries(Object.keys(value.choices || {}).map(choiceId => [choiceId, 0]));
      let total = 0;
      Object.values(ballots).forEach(ballot => {
        if (ballot && Object.hasOwn(counts, ballot.choiceId)) {
          counts[ballot.choiceId] += 1;
          total += 1;
        }
      });
      const summary = Object.entries(value.choices || {}).map(([choiceId, label]) => {
        const count = counts[choiceId];
        const percent = total ? Math.round(count * 100 / total) : 0;
        return `${label}: ${count} (${percent}%)`;
      });
      title.textContent = 'Vote results';
      description.textContent = `${value.title || 'Community vote'}\n${summary.join('\n')}\n${total} total votes`;
      prompt.textContent = 'Final results have been announced.';
      try {
        sessionStorage.setItem(key, '1');
      } catch (error) {
        console.warn('Could not save vote result popup session state:', error);
      }
      popup.showModal();
      return;
    }
  }

  firebase.auth().onAuthStateChanged(user => {
    currentUser = user;
    authReady = true;
    checkForOpenVote();
  });

  firebase.database().ref('voteCatalog').on('value', snapshot => {
    polls = [];
    snapshot.forEach(child => {
      const value = child.val();
      if (value) polls.push({ id: child.key, value });
    });
    checkForOpenVote();
  }, error => console.error('Could not load vote popup information:', error));

  window.setInterval(checkForOpenVote, 15000);
})();
