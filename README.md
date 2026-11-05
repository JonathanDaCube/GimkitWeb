# GimkitWeb
The Offical Gimkit Community website's source repository.
Visit the webste at https://jonathandacube.github.io/GimkitWeb/.

## Push notifications

The site uses Firebase Cloud Messaging and Firebase Functions to send push notifications when a game or meeting starts, about five minutes before a scheduled meeting, when an opted-in admin receives a score submission, and when an opted-in user is notified about news. Game, meeting, and scheduled-meeting notifications are enabled by default; score-review and news notifications are disabled by default.

Users must sign in with a verified account, visit **Settings**, enable browser notifications, and allow the browser permission prompt. Browsers do not allow websites to grant notification permission automatically. Notification preferences are stored per account in Realtime Database, and push tokens are stored under that account.

To deploy the backend, install the Functions dependencies with `npm install --prefix functions`, then deploy Realtime Database rules and Functions with `firebase deploy --only database,functions`. The scheduled five-minute reminder uses Cloud Scheduler; Firebase Functions deployment may require a billing-enabled Firebase project. Hosting remains on GitHub Pages and deploys through the existing GitHub Actions workflow.

Functions run on Node.js 22. Make sure Firebase Cloud Messaging is enabled for the web app before deploying; each user must enable notifications from Settings on every browser/device they want to receive them on.
