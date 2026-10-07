(() => {
  if (new URLSearchParams(window.location.search).get('embedded') === '1') return;

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/GimkitWeb';
  const navItems = [
    { label: 'Home', href: '/GimkitWeb/', path: '/GimkitWeb' },
    { label: 'News', href: '/GimkitWeb/news/', path: '/GimkitWeb/news' },
    { label: 'Admin', href: '/GimkitWeb/admin/', path: '/GimkitWeb/admin', adminOnly: true },
    { label: 'Owner', href: '/GimkitWeb/owner/', path: '/GimkitWeb/owner', ownerOnly: true }
  ];

  const sidebar = document.createElement('aside');
  sidebar.id = 'siteSidebar';
  sidebar.setAttribute('aria-label', 'Site navigation');

  const heading = document.createElement('h2');
  heading.textContent = 'Gimkit Community';

  const nav = document.createElement('nav');
  navItems.forEach(item => {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.label;
    if (item.adminOnly) {
      link.id = 'siteAdminLink';
      link.hidden = true;
    }
    if (item.ownerOnly) {
      link.id = 'siteOwnerLink';
      link.hidden = true;
    }
    if (currentPath === item.path) {
      link.setAttribute('aria-current', 'page');
    }
    nav.appendChild(link);
  });

  sidebar.append(heading, nav);
  document.body.prepend(sidebar);

  if (!window.firebase || !firebase.apps.length || !firebase.auth) return;

  firebase.auth().onAuthStateChanged(user => {
    const adminLink = document.getElementById('siteAdminLink');
    const ownerLink = document.getElementById('siteOwnerLink');
    const isOwner = Boolean(
      user &&
      !user.isAnonymous &&
      user.emailVerified &&
      user.email &&
      user.email.toLowerCase() === 'jonathanlam0820@gmail.com'
    );
    if (ownerLink) ownerLink.hidden = !isOwner;
    if (adminLink) adminLink.hidden = !isOwner;
    if (!user || user.isAnonymous || !user.emailVerified || isOwner) return;

    firebase.database().ref(`admins/${user.uid}`).once('value')
      .then(snapshot => {
        const admin = snapshot.val();
        if (firebase.auth().currentUser && firebase.auth().currentUser.uid === user.uid && adminLink) {
          adminLink.hidden = !admin || admin.email !== user.email.toLowerCase();
        }
      })
      .catch(error => {
        console.error('Could not determine admin navigation access:', error);
      });
  }, error => {
    console.error('Could not determine admin navigation access:', error);
  });
})();
