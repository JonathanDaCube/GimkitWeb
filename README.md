# GimkitWeb
The gimkit website

## Database access

Visitors can read the public games and meeting lists without signing in. Realtime Database writes require a signed-in, non-anonymous Firebase account; the site disables write controls for signed-out visitors, and Firebase rules enforce the restriction independently of the UI. The site does not create anonymous sessions or use scheduled Cloud Functions. Any future callable Cloud Functions must also reject unauthenticated and anonymous requests explicitly.

Deploy the database rules with the Firebase CLI (no Cloud Functions or paid plan is required):

```sh
firebase deploy --only database
```
