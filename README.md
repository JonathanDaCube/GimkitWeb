# GimkitWeb
The gimkit website

## Database access

Visitors can read the public games and meeting lists without signing in. Realtime Database writes require a signed-in, non-anonymous Firebase account; the site disables write controls for signed-out visitors, and Firebase rules enforce the restriction independently of the UI. The site does not create anonymous sessions or use scheduled Cloud Functions. Any future callable Cloud Functions must also reject unauthenticated and anonymous requests explicitly.

News is publicly readable at `/news/`. The authorized administrator can publish, edit, and delete posts from Admin Mode; each post includes a title, a homepage summary, and article text.

Admin Mode is available to the verified owner account and additional verified admins managed from Owner Mode. The owner can add an admin by entering their Firebase Authentication UID and verified account email, or remove them at any time. Realtime Database rules enforce admin privileges for administrative changes; other signed-in users can create game and meeting entries but cannot edit or delete existing entries. The `/admin/` and `/owner/` pages are static GitHub Pages files, so their source URLs cannot be made private; the interfaces are gated, and the database rules protect privileged writes.

Deploy the database rules with the Firebase CLI (no Cloud Functions or paid plan is required):

```sh
firebase deploy --only database
```
