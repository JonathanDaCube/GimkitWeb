# GimkitWeb
The gimkit website

## Database access

Visitors can read the public games and meeting lists without signing in. Realtime Database writes require a signed-in, non-anonymous Firebase account; the site disables write controls for signed-out visitors, and Firebase rules enforce the restriction independently of the UI. The site does not create anonymous sessions or use scheduled Cloud Functions. Any future callable Cloud Functions must also reject unauthenticated and anonymous requests explicitly.

News is publicly readable at `/news/`. The authorized administrator can publish, edit, and delete posts from Admin Mode; each post includes a title, a homepage summary, and article text.

Admin Mode requires a verified sign-in for `jonathanlam0820@gmail.com`. Realtime Database rules enforce that account restriction for administrative changes; other signed-in users can create game and meeting entries but cannot edit or delete existing entries. The `/admin/` page is a static GitHub Pages file, so its source URL itself cannot be made private; the admin interface is hidden unless the authorized account is signed in, and the database blocks unauthorized administrative writes.

Deploy the database rules with the Firebase CLI (no Cloud Functions or paid plan is required):

```sh
firebase deploy --only database
```
