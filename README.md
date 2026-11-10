# GimkitWeb
The Offical Gimkit Community website's source repository.
Visit the webste at https://jonathandacube.github.io/GimkitWeb/.

## Community voting

Admins can submit vote proposals for owner approval from the Voting page. Approved votes accept one ballot per signed-in, non-anonymous account between the configured start and end times. Admins and the owner can change a vote's schedule, opening popup, and results visibility until its start time.

The opening popup and public results are enabled by default. When public results are disabled, ballots and totals remain visible only to admins and the owner on the Voting page after the vote ends. The popup appears while a vote is open; when public results are enabled, the latest results are also announced in a homepage popup after voting ends. Popups can be dismissed for the current browser session. Deploy Realtime Database rule changes with `firebase deploy --only database`.

## Elo scoreboard

Players start at 50 Elo for each game mode. A signed-in player submits the full match roster and finishing places; an admin must approve the result before ratings change. Rating changes compare each player's placements against Elo-based expectations, with gains capped at 8 and losses capped at 2 Elo per match. The total leaderboard averages a player's six mode ratings. Registered player usernames resolve to stable account IDs so Elo history follows username changes; unregistered roster names remain keyed by name.

## Account settings

The Settings page lets signed-in users choose a unique account username, disable automatic vote popups across their account, and request a password reset email. Usernames are globally reserved and displayed throughout the site; email remains the sign-in identifier. Usernames must be 3-20 lowercase letters, numbers, underscores, or hyphens. Username changes preserve Elo history, and prior names remain reserved as aliases to the same account. Existing accounts claim their current username the next time they sign in or visit an authenticated page; a conflicting or invalid legacy name must be changed in Settings.
