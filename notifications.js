(() => {
  if (!window.firebase || !firebase.apps.length || !firebase.messaging) return;

  firebase.messaging.isSupported().then(supported => {
    if (!supported) return;
    firebase.messaging().onMessage(payload => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const data = payload.data || {};
      const options = {
        body: data.body || 'There is an update for you.',
        icon: '/GimkitWeb/icon.svg',
        data: { url: data.url || '/GimkitWeb/' }
      };
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration('/GimkitWeb/').then(registration => {
          if (registration) return registration.showNotification(data.title || 'Gimkit Community', options);
          else new Notification(data.title || 'Gimkit Community', options);
        }).catch(error => console.error('Could not show browser notification:', error));
      } else {
        new Notification(data.title || 'Gimkit Community', options);
      }
    });
  }).catch(error => console.error('Could not initialize browser notifications:', error));
})();
