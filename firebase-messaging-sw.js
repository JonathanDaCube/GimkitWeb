importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDq6eOzOWLd88XG-wFo0LN1O3l2Yyvdfls',
  authDomain: 'gimkit-web.firebaseapp.com',
  databaseURL: 'https://gimkit-web-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'gimkit-web',
  storageBucket: 'gimkit-web.firebasestorage.app',
  messagingSenderId: '192282058649',
  appId: '1:192282058649:web:cdcdfdb49c429fc0e33d08',
  measurementId: 'G-TLCCKP056J'
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'Gimkit Community', {
    body: data.body || 'There is an update for you.',
    icon: '/GimkitWeb/icon.svg',
    data: { url: data.url || '/GimkitWeb/' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || '/GimkitWeb/', self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin &&
    requestedUrl.pathname.startsWith('/GimkitWeb/')
    ? requestedUrl.href
    : new URL('/GimkitWeb/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (const client of windowClients) {
      if (client.url.startsWith(self.location.origin + '/GimkitWeb/') && 'focus' in client) {
        return client.navigate(targetUrl).then(() => client.focus());
      }
    }
    return self.clients.openWindow(targetUrl);
  }));
});
