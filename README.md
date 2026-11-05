# GimkitWeb
The Offical Gimkit Community website's source repository.
Visit the webste at https://jonathandacube.github.io/GimkitWeb/.

## Community voting

Admins can submit vote proposals for owner approval from the Voting page. Approved votes accept one ballot per signed-in, non-anonymous account between the configured start and end times. Admins and the owner can change a vote's schedule, opening popup, and results visibility until its start time.

The opening popup and public results are enabled by default. When public results are disabled, ballots and totals remain visible only to admins and the owner on the Voting page after the vote ends. The popup appears while a vote is open; when public results are enabled, the latest results are also announced in a homepage popup after voting ends. Popups can be dismissed for the current browser session. Deploy Realtime Database rule changes with `firebase deploy --only database`.

## Elo scoreboard

Players start at 50 Elo for each game mode. A signed-in player submits the full match roster and finishing places; an admin must approve the result before ratings change. Rating changes compare each player's placements against Elo-based expectations, with gains capped at 8 and losses capped at 2 Elo per match. The total leaderboard averages a player's six mode ratings. Match results are stored by submitted usernames, so usernames are treated as the player's scoreboard identity.
