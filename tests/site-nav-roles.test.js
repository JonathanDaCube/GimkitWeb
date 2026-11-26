const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function navigation(pathname = '/GimkitWeb/') {
  const elements = {};
  function element() {
    return {
      hidden: false,
      children: [],
      attributes: {},
      set id(value) { elements[value] = this; },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); }
    };
  }
  let sidebar;
  let onAuth;
  let resolveAdmin;
  const auth = {
    currentUser: null,
    onAuthStateChanged(callback) { onAuth = callback; }
  };
  const firebase = {
    apps: [{}],
    auth: () => auth,
    database: () => ({
      ref: () => ({ once: () => new Promise(resolve => { resolveAdmin = resolve; }) })
    })
  };
  const document = {
    createElement: element,
    getElementById: id => elements[id],
    body: { prepend(node) { sidebar = node; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'site-nav.js'), 'utf8'), {
    window: { location: { pathname, search: '' }, firebase },
    document, firebase, URLSearchParams, console
  });
  return {
    signIn(user) { auth.currentUser = user; onAuth(user); },
    async respond(record) { resolveAdmin({ val: () => record }); await new Promise(resolve => setImmediate(resolve)); },
    admin: () => !elements.siteAdminLink.hidden,
    owner: () => !elements.siteOwnerLink.hidden,
    links: () => sidebar.children[1].children
  };
}

const user = (uid, email, verified = true) => ({ uid, email, emailVerified: verified, isAnonymous: false });

test('app page is available in navigation and marked current', () => {
  const nav = navigation('/GimkitWeb/app/');
  const app = nav.links().find(link => link.textContent === 'App');
  assert.equal(app.href, '/GimkitWeb/app/');
  assert.equal(app.attributes['aria-current'], 'page');
  assert.equal(app.hidden, false);
});

test('owner flag requires matching verified account; legacy admins remain admins', async () => {
  const nav = navigation();
  nav.signIn(user('admin', 'admin@example.com'));
  await nav.respond({ email: 'admin@example.com' });
  assert.equal(nav.admin(), true);
  assert.equal(nav.owner(), false);
  nav.signIn(user('owner', 'owner@example.com'));
  await nav.respond({ email: 'owner@example.com', owner: true });
  assert.equal(nav.admin(), true);
  assert.equal(nav.owner(), true);
  nav.signIn(user('owner', 'owner@example.com'));
  await nav.respond({ email: 'wrong@example.com', owner: true });
  assert.equal(nav.admin(), false);
  assert.equal(nav.owner(), false);
  nav.signIn(user('owner', 'owner@example.com', false));
  assert.equal(nav.admin(), false);
  assert.equal(nav.owner(), false);
  nav.signIn(user('bootstrap', 'jonathandacube@gmail.com'));
  assert.equal(nav.admin(), true);
  assert.equal(nav.owner(), true);
  nav.signIn(user('old-bootstrap', 'jonathanlam0820@gmail.com'));
  assert.equal(nav.admin(), true);
  assert.equal(nav.owner(), true);
  nav.signIn(user('old-bootstrap', 'jonathanlam0820@gmail.com', false));
  assert.equal(nav.admin(), false);
  assert.equal(nav.owner(), false);
});

test('late role lookups cannot reveal links after sign-out', async () => {
  const nav = navigation();
  nav.signIn(user('owner', 'owner@example.com'));
  nav.signIn(null);
  await nav.respond({ email: 'owner@example.com', owner: true });
  assert.equal(nav.admin(), false);
  assert.equal(nav.owner(), false);
});
