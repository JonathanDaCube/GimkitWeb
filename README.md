# GimkitWeb
The Offical Gimkit Community website's source repository.
Visit the webste at https://jonathandacube.github.io/GimkitWeb/.

## Community voting

Admins can submit vote proposals for owner approval from the Voting page. Approved votes accept one ballot per signed-in, non-anonymous account between the configured start and end times. Admins and the owner can change a vote's schedule, opening popup, and results visibility until its start time.

The opening popup and public results are enabled by default. When public results are disabled, ballots and totals remain visible only to admins and the owner on the Voting page after the vote ends. The popup appears while a vote is open; when public results are enabled, the latest results are also announced in a homepage popup after voting ends. Popups can be dismissed for the current browser session. Deploy Realtime Database rule changes with `firebase deploy --only database`.

## Elo scoreboard

Players start at 50 Elo for each game mode. A signed-in player submits the full match roster and finishing places; an admin must approve the result before ratings change. Rating changes compare each player's placements against Elo-based expectations, with gains capped at 8 and losses capped at 2 Elo per match. The total leaderboard averages a player's five mode ratings and displays the result to two decimal places. Registered player usernames resolve to stable account IDs so Elo history follows username changes; unregistered roster names remain keyed by name.

The participation leaderboard awards one point to each player in every approved match, across the supported game modes and regardless of placement. Existing Fishtopia results remain stored but are excluded from ratings and participation. Deploy the website and database rules together (`firebase deploy --only database`) to prevent new Fishtopia submissions.

## Account settings

The Settings page lets signed-in users choose a unique account username, disable automatic vote popups across their account, and request a password reset email. Usernames are globally reserved and displayed throughout the site; email remains the sign-in identifier. Usernames must be 3-20 lowercase letters, numbers, underscores, or hyphens. Username changes preserve Elo history, and prior names remain reserved as aliases to the same account. Existing accounts claim their current username the next time they sign in or visit an authenticated page; a conflicting or invalid legacy name must be changed in Settings.

## Owner and admin access

The verified `jonathandacube@gmail.com` and `jonathanlam0820@gmail.com` accounts are bootstrap owners. Owners can grant admins access and promote them to owners from Owner Mode; an owner can manage other owners too. Firebase stores the role under `admins/<uid>` with a matching email and `owner: true` for owners or `owner: false` for admins. Existing admin records without the field remain admins. All privileged users must sign in with the matching verified email.

Deploy both the website and `database.rules.json` (`firebase deploy --only database`) for role changes to take effect. If Owner Mode says the signed-in email is unverified, verify the email and sign out and back in. Adding an owner record does not bypass email verification or create an initial owner: if neither bootstrap account can sign in as verified, resolve an account in Firebase Authentication first.

## Windows meeting notifications

The optional companion checks the public meeting lists and shows a Windows notification when an active meeting is added or a scheduled meeting starts. It does not need a Firebase account, Cloud Functions, or a paid Firebase plan.

Visitors can download a self-contained 64-bit Windows ZIP from the website's App page. The Pages deployment builds the ZIP from the companion source; extract it to a permanent folder and open `gimkitapp.exe` to start the checker and enable startup.

To build the companion from source:

1. Install Visual Studio 2026 or later with the .NET desktop development workload and .NET 10 SDK, then download this repository.
2. Open `companion\GimkitWebNotifications.csproj` in Visual Studio and build it. The built executable is `companion\bin\Debug\net10.0\gimkitapp.exe`; keep `notify.ps1`, `notification-icon.png`, and `notification-icon.ico` beside it. The target computer also needs the .NET 10 runtime.
3. Add the absolute path of that build folder to your Windows **user PATH** in Environment Variables, then open a new console. If you build Release or publish elsewhere, add that output folder instead.
4. Double-click `gimkitapp.exe` or run `gimkitapp` without arguments. It displays a welcome message, restarts the background checker, and registers it to start at Windows sign-in for the current user. Keep the published app folder in place.
5. From any console, use `gimkitapp start`, `stop`, `restart`, or `query` to manage the checker. Query reports whether it is stopped, checking (`started`), idle between checks, or has encountered an error. Use `gimkitapp check` for an immediate one-off check, `last` for check times, and `help` for all commands.

The first successful check ignores already-active meetings and past scheduled meetings; future scheduled meetings are watched. Later checks run about every minute, plus notification and network time. Automatic checks run without a console; use `query` to see errors. Manual checks report their result. One-off checks share state with the background checker and wait for any check already in progress. State is kept in `%LOCALAPPDATA%\GimkitWebNotifications\state.json`, including notification history from the previous Node companion, so meetings already notified are not repeated after restarting. The last successful-check time is recorded only after a complete successful check; older state files have no last-check time until the next successful check. The app catches up on entries still present after an outage, but cannot recover meetings removed before it checks. It only works while Windows is awake, the user is signed in, and the companion is running. Windows notification settings and Do Not Disturb can suppress notifications. Firebase free-plan usage limits still apply.

Automatic startup uses the current user's `GimkitWebNotifications` entry in `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`. Stopping the checker does not disable startup; remove that entry or disable it in Windows Startup settings to prevent it starting at the next sign-in.

Notifications register a per-user Windows app identity and Start menu shortcut named Gimkit Community App, using icons derived from the repository's `icon.svg`. Disabled app notifications are reported through `gimkitapp query`; Do Not Disturb can still suppress notifications.
