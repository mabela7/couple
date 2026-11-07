import "./style.css";

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "firebase/auth";

import {
  ref,
  get,
  set,
  update,
  push,
  onValue,
  onChildAdded,
  query,
  orderByChild,
  limitToLast,
  serverTimestamp
} from "firebase/database";

/*
  us. — couples app
  Replace src/main.js with this file.

  Required existing files:
    src/firebase.js
    src/style.css
    index.html

  Expected HTML mount points:
    #app, #view, #modal-root, #toast

  Firebase Realtime Database:
    This app stores profiles at /users/{uid}, connections in each
    user's partnerUid field, and shared data in /rooms/{sortedUidPair}/...

  IMPORTANT:
  - Both people must use the same Firebase project.
  - Add the two actual Firebase Auth UIDs to your database rules.
  - Do not publish your Cloudflare Worker secret in this file.
*/

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const appRoot = $("#app") || document.body;
const viewRoot = $("#view") || appRoot;
const modalRoot = $("#modal-root") || appRoot;
const toastRoot = $("#toast") || (() => {
  const el = document.createElement("div");
  el.id = "toast";
  document.body.appendChild(el);
  return el;
})();

const state = {
  user: null,
  profile: null,
  partner: null,
  tab: "home",
  partnerUnsub: null,
  tabUnsubs: [],
  callUnsubs: [],
  call: null,
  pc: null,
  localStream: null,
  remoteStream: null,
  screenStream: null,
  recorder: null,
  recordingChunks: [],
  recordingCallId: null,
  callStartedAt: 0,
  callTimer: null,
  toastTimer: null,
  currentFile: null,
  authBusy: false
};

const esc = (value = "") =>
  String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

const cleanEmail = email => String(email || "").trim().toLowerCase();
const uid = () => state.user?.uid || null;
const userRef = id => ref(db, `users/${id}`);
const roomId = () => [uid(), state.partner?.uid].filter(Boolean).sort().join("_");
const roomRef = (path = "") => ref(db, `rooms/${roomId()}${path ? `/${path}` : ""}`);
const now = () => Date.now();

function toast(message, duration = 3200) {
  if (!toastRoot) return;
  toastRoot.textContent = message;
  toastRoot.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastRoot.classList.remove("show"), duration);
}

function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-email": "That email address doesn't look valid.",
    "auth/user-not-found": "No account was found with that email.",
    "auth/wrong-password": "That password is incorrect.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Use a stronger password (at least 6 characters).",
    "auth/network-request-failed": "Network error. Check your connection.",
    "PERMISSION_DENIED": "Firebase denied access. Check your Realtime Database rules and allowed UIDs."
  };
  return messages[code] || error?.message || "Something went wrong.";
}

function setBusy(button, busy, label = "Please wait…") {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.oldText) button.textContent = button.dataset.oldText;
    delete button.dataset.oldText;
  }
}

function listen(path, callback, options = {}) {
  const databaseRef = ref(db, path);
  const unsubscribe = onValue(databaseRef, snapshot => callback(snapshot.val(), snapshot), error => {
    console.error(`Realtime Database listener failed at ${path}`, error);
    toast(friendlyError(error));
  }, options);
  state.tabUnsubs.push(unsubscribe);
  return unsubscribe;
}

function clearTabListeners() {
  state.tabUnsubs.forEach(unsubscribe => {
    try { unsubscribe(); } catch {}
  });
  state.tabUnsubs = [];
}

function clearPartnerListener() {
  if (state.partnerUnsub) {
    state.partnerUnsub();
    state.partnerUnsub = null;
  }
}

function initials(name = "U") {
  return String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
}

function avatar(profile, size = "") {
  const name = profile?.name || profile?.email || "U";
  const image = profile?.photoURL;
  return `<span class="avatar ${size}">${image ? `<img src="${esc(image)}" alt="">` : esc(initials(name))}</span>`;
}

function formatDate(value) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return [h, m, s].map(part => String(part).padStart(2, "0")).join(":");
}

function emptyState(icon, title, message, button = "") {
  return `<section class="empty-state">
    <div class="empty-icon">${icon}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(message)}</p>
    ${button}
  </section>`;
}

function renderAuth() {
  appRoot.innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <div class="brand-mark">us<span>.</span></div>
        <p class="eyebrow">A little space for two</p>
        <h1 id="auth-title">Welcome back.</h1>
        <p class="muted" id="auth-subtitle">Sign in to your private space.</p>
        <form id="auth-form" class="stack">
          <label>Email<input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <label id="name-field" class="hidden">Your name<input id="auth-name" type="text" autocomplete="name" placeholder="Your name"></label>
          <label>Password<input id="auth-password" type="password" autocomplete="current-password" minlength="6" required placeholder="At least 6 characters"></label>
          <button class="primary-btn" id="auth-submit" type="submit">Sign in</button>
        </form>
        <p class="auth-switch"><span id="auth-switch-text">New here?</span>
          <button class="text-btn" id="auth-toggle" type="button">Create an account</button>
        </p>
      </section>
    </main>`;

  let signup = false;
  const title = $("#auth-title");
  const subtitle = $("#auth-subtitle");
  const nameField = $("#name-field");
  const submit = $("#auth-submit");
  const switchText = $("#auth-switch-text");
  const toggle = $("#auth-toggle");
  const password = $("#auth-password");

  toggle.addEventListener("click", () => {
    signup = !signup;
    title.textContent = signup ? "Make your space." : "Welcome back.";
    subtitle.textContent = signup ? "Create your account to get started." : "Sign in to your private space.";
    nameField.classList.toggle("hidden", !signup);
    submit.textContent = signup ? "Create account" : "Sign in";
    switchText.textContent = signup ? "Already have an account?" : "New here?";
    toggle.textContent = signup ? "Sign in" : "Create an account";
    password.autocomplete = signup ? "new-password" : "current-password";
  });

  $("#auth-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.authBusy) return;
    const email = cleanEmail($("#auth-email").value);
    const pass = password.value;
    const name = $("#auth-name").value.trim();
    if (signup && !name) return toast("Enter your name first.");

    state.authBusy = true;
    setBusy(submit, true, signup ? "Creating…" : "Signing in…");
    try {
      if (signup) {
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(result.user, { displayName: name });
        await set(userRef(result.user.uid), {
          uid: result.user.uid,
          email,
          name,
          photoURL: "",
          partnerUid: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        // Email index makes partner lookup fast and avoids scanning every profile.
        await set(ref(db, `emailIndex/${encodeURIComponent(email)}`), result.user.uid);
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
    } catch (error) {
      console.error(error);
      toast(friendlyError(error), 5000);
      state.authBusy = false;
      setBusy(submit, false);
    }
  });
}

function renderShell() {
  const name = state.profile?.name || state.user?.displayName || "Your space";
  appRoot.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" data-tab-link="home">us<span>.</span></a>
        <div class="topbar-right">
          <span class="topbar-name">${esc(name)}</span>
          <button class="icon-btn" id="settings-open" aria-label="Settings">⚙</button>
        </div>
      </header>
      <main id="view" class="view"></main>
      <nav class="bottom-nav">
        <button data-tab="home" class="nav-item"><span>⌂</span><small>Home</small></button>
        <button data-tab="chat" class="nav-item"><span>♡</span><small>Chat</small></button>
        <button data-tab="memories" class="nav-item"><span>▧</span><small>Memories</small></button>
        <button data-tab="calls" class="nav-item"><span>◉</span><small>Calls</small></button>
        <button data-tab="profile" class="nav-item"><span>○</span><small>You</small></button>
      </nav>
    </div>`;

  $("#settings-open").addEventListener("click", settingsModal);
  $$("[data-tab]").forEach(button => button.addEventListener("click", () => go(button.dataset.tab)));
  $$("[data-tab-link]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault();
    go(link.dataset.tabLink);
  }));
  renderTab();
}

function go(tab) {
  state.tab = tab;
  renderTab();
}

function renderTab() {
  clearTabListeners();
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.tab === state.tab));
  if (!viewRoot) return;

  if (state.tab === "home") homeView();
  else if (state.tab === "chat") chatView();
  else if (state.tab === "memories") memoriesView();
  else if (state.tab === "calls") callsView();
  else if (state.tab === "profile") profileView();
  else homeView();
}

function partnerPrompt() {
  return emptyState("♡", "Just you for now", "Connect your person using their account email to open your shared space.",
    `<button class="primary-btn" id="connect-open">Connect your person</button>`);
}

function bindConnectButton() {
  $("#connect-open")?.addEventListener("click", connectModal);
}

function homeView() {
  if (!state.partner) {
    viewRoot.innerHTML = `<section class="page-heading"><p class="eyebrow">YOUR SPACE</p><h1>Two people.<br>One little world.</h1></section>${partnerPrompt()}`;
    bindConnectButton();
    return;
  }

  viewRoot.innerHTML = `
    <section class="page-heading">
      <p class="eyebrow">YOUR SHARED SPACE</p>
      <h1>Hey, ${esc((state.profile?.name || "you").split(" ")[0])}.</h1>
      <p class="muted">A place for the little things that matter.</p>
    </section>
    <section class="couple-card">
      <div class="couple-avatars">${avatar(state.profile)}<span class="heart-dot">♡</span>${avatar(state.partner)}</div>
      <h2>${esc(state.partner.name || state.partner.email || "Your person")}</h2>
      <p class="muted">Connected together</p>
    </section>
    <section class="quick-grid">
      <button class="quick-card" data-go="chat"><span>♡</span><b>Send a message</b><small>Say what's on your mind</small></button>
      <button class="quick-card" data-go="memories"><span>▧</span><b>Save a memory</b><small>Keep a moment close</small></button>
      <button class="quick-card" data-go="calls"><span>◉</span><b>Call each other</b><small>Be there, even from afar</small></button>
    </section>
    <section class="section-heading"><h2>Recent messages</h2><button class="text-btn" data-go="chat">See all</button></section>
    <div id="home-recent" class="recent-list"><p class="muted">Loading…</p></div>`;

  $$("[data-go]").forEach(button => button.addEventListener("click", () => go(button.dataset.go)));
  const messagesRef = query(roomRef("messages"), orderByChild("createdAt"), limitToLast(4));
  const unsub = onValue(messagesRef, snapshot => {
    const messages = [];
    snapshot.forEach(child => messages.push({ id: child.key, ...child.val() }));
    messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const target = $("#home-recent");
    if (!target) return;
    target.innerHTML = messages.length ? messages.map(message => `
      <article class="recent-message">
        <b>${esc(message.senderName || "Someone")}</b>
        <p>${esc(message.text || "Attachment")}</p>
        <small>${formatDate(message.createdAt)}</small>
      </article>`).join("") : `<p class="muted">Your first message is waiting.</p>`;
  }, error => toast(friendlyError(error)));
  state.tabUnsubs.push(unsub);
}

function chatView() {
  if (!state.partner) {
    viewRoot.innerHTML = `<section class="page-heading"><p class="eyebrow">MESSAGES</p><h1>Say it here.</h1></section>${partnerPrompt()}`;
    bindConnectButton();
    return;
  }

  viewRoot.innerHTML = `
    <section class="page-heading compact-heading"><p class="eyebrow">JUST YOU TWO</p><h1>Messages</h1>
      <p class="muted">A private conversation between you and ${esc(state.partner.name || "your person")}.</p>
    </section>
    <section id="message-list" class="message-list"><p class="muted">Loading messages…</p></section>
    <form id="message-form" class="message-composer">
      <input id="message-input" maxlength="4000" autocomplete="off" placeholder="Write something…" required>
      <button class="send-btn" type="submit" aria-label="Send">➤</button>
    </form>`;

  const list = $("#message-list");
  const messagesRef = query(roomRef("messages"), orderByChild("createdAt"), limitToLast(100));
  const unsub = onValue(messagesRef, snapshot => {
    const messages = [];
    snapshot.forEach(child => messages.push({ id: child.key, ...child.val() }));
    messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    list.innerHTML = messages.length ? messages.map(message => {
      const mine = message.senderUid === uid();
      return `<article class="bubble-row ${mine ? "mine" : "theirs"}">
        <div class="bubble">
          ${message.text ? `<p>${esc(message.text)}</p>` : ""}
          ${message.fileUrl ? `<button class="file-link" data-file="${esc(message.fileUrl)}" data-name="${esc(message.fileName || "Shared file")}">▧ ${esc(message.fileName || "Shared file")}</button>` : ""}
          <small>${formatDate(message.createdAt)}</small>
        </div>
      </article>`;
    }).join("") : `<div class="chat-empty">This is the start of something.</div>`;
    list.scrollTop = list.scrollHeight;
    $$("[data-file]", list).forEach(button => button.addEventListener("click", () => openSharedFile(button.dataset.file, button.dataset.name)));
  }, error => toast(friendlyError(error)));
  state.tabUnsubs.push(unsub);

  $("#message-form").addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("#message-input");
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await push(roomRef("messages"), {
        text,
        senderUid: uid(),
        senderName: state.profile?.name || "Me",
        createdAt: now()
      });
      input.value = "";
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

function memoriesView() {
  if (!state.partner) {
    viewRoot.innerHTML = `<section class="page-heading"><p class="eyebrow">YOUR MOMENTS</p><h1>Keep the good stuff.</h1></section>${partnerPrompt()}`;
    bindConnectButton();
    return;
  }

  viewRoot.innerHTML = `
    <section class="page-heading"><p class="eyebrow">LITTLE TIME CAPSULE</p><h1>Memories</h1>
      <p class="muted">Save moments you don't want to lose.</p></section>
    <form id="memory-form" class="memory-form">
      <textarea id="memory-text" maxlength="3000" placeholder="What do you want to remember?" required></textarea>
      <div class="form-actions"><label class="file-pick">＋ Add a file<input id="memory-file" type="file" accept="image/*,video/*"></label><button class="primary-btn" type="submit">Save memory</button></div>
      <small id="memory-file-name" class="muted"></small>
    </form>
    <section id="memory-list" class="memory-list"><p class="muted">Loading memories…</p></section>`;

  $("#memory-file").addEventListener("change", event => {
    $("#memory-file-name").textContent = event.target.files[0]?.name || "";
  });

  $("#memory-form").addEventListener("submit", async event => {
    event.preventDefault();
    const text = $("#memory-text").value.trim();
    const file = $("#memory-file").files[0];
    if (!text && !file) return toast("Write something or attach a file.");
    const button = $('button[type="submit"]', event.currentTarget);
    setBusy(button, true, "Saving…");
    try {
      let uploaded = null;
      if (file) uploaded = await uploadFile(file);
      await push(roomRef("memories"), {
        text,
        fileUrl: uploaded?.url || "",
        fileName: uploaded?.name || "",
        senderUid: uid(),
        senderName: state.profile?.name || "Me",
        createdAt: now()
      });
      event.currentTarget.reset();
      $("#memory-file-name").textContent = "";
      toast("Memory saved.");
    } catch (error) {
      console.error(error);
      toast(friendlyError(error), 5000);
    } finally {
      setBusy(button, false);
    }
  });

  const unsub = onValue(query(roomRef("memories"), orderByChild("createdAt"), limitToLast(100)), snapshot => {
    const items = [];
    snapshot.forEach(child => items.push({ id: child.key, ...child.val() }));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    $("#memory-list").innerHTML = items.length ? items.map(item => `
      <article class="memory-card">
        <p>${esc(item.text || "")}</p>
        ${item.fileUrl ? `<button class="memory-attachment" data-file="${esc(item.fileUrl)}" data-name="${esc(item.fileName || "Memory attachment")}">▧ ${esc(item.fileName || "Open attachment")}</button>` : ""}
        <footer><span>${esc(item.senderName || "")}</span><time>${formatDate(item.createdAt)}</time></footer>
      </article>`).join("") : `<p class="muted">No memories yet. Start with one small moment.</p>`;
    $$("[data-file]", $("#memory-list")).forEach(button => button.addEventListener("click", () => openSharedFile(button.dataset.file, button.dataset.name)));
  }, error => toast(friendlyError(error)));
  state.tabUnsubs.push(unsub);
}

function callsView() {
  if (!state.partner) {
    viewRoot.innerHTML = `<section class="page-heading"><p class="eyebrow">BE HERE</p><h1>Hear their voice.</h1></section>${partnerPrompt()}`;
    bindConnectButton();
    return;
  }
  viewRoot.innerHTML = `
    <section class="page-heading"><p class="eyebrow">A LITTLE CLOSER</p><h1>Calls</h1><p class="muted">Call ${esc(state.partner.name || "your person")}.</p></section>
    <section class="call-card">
      <div class="large-avatar">${avatar(state.partner, "large")}</div>
      <h2>${esc(state.partner.name || "Your person")}</h2>
      <p class="muted">${esc(state.partner.email || "")}</p>
      <div class="call-actions">
        <button class="primary-btn" id="voice-call">◉ Voice call</button>
        <button class="secondary-btn" id="video-call">▣ Video call</button>
      </div>
      <p class="tiny-note">Calls need microphone/camera permission and a working network connection.</p>
    </section>
    <section class="section-heading"><h2>Recent calls</h2></section>
    <section id="call-history" class="call-history"><p class="muted">Loading…</p></section>`;

  $("#voice-call").addEventListener("click", () => startCall(false));
  $("#video-call").addEventListener("click", () => startCall(true));

  const unsub = onValue(query(roomRef("calls"), orderByChild("startedAt"), limitToLast(30)), snapshot => {
    const calls = [];
    snapshot.forEach(child => calls.push({ id: child.key, ...child.val() }));
    calls.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    $("#call-history").innerHTML = calls.length ? calls.map(call => `
      <article class="history-row"><span>${call.video ? "▣" : "◉"}</span>
        <div><b>${call.video ? "Video call" : "Voice call"}</b><small>${formatDate(call.startedAt)}</small></div>
        <time>${formatDuration(call.duration || 0)}</time></article>`).join("") : `<p class="muted">No calls yet.</p>`;
  }, error => toast(friendlyError(error)));
  state.tabUnsubs.push(unsub);
}

function profileView() {
  const profile = state.profile || {};
  viewRoot.innerHTML = `
    <section class="page-heading"><p class="eyebrow">YOUR SIDE OF US.</p><h1>Your profile</h1></section>
    <section class="profile-card">
      ${avatar(profile, "profile-avatar")}
      <h2>${esc(profile.name || "Your name")}</h2>
      <p class="muted">${esc(profile.email || state.user?.email || "")}</p>
    </section>
    <form id="profile-form" class="profile-form">
      <label>Display name<input id="profile-name" maxlength="60" value="${esc(profile.name || "")}" required></label>
      <button class="primary-btn" type="submit">Save changes</button>
    </form>
    <section class="settings-row"><div><b>Connected person</b><small>${esc(state.partner?.email || "Not connected")}</small></div>
      <button class="text-btn" id="profile-connect">${state.partner ? "Reconnect" : "Connect"}</button></section>
    <button class="danger-btn" id="logout-btn">Sign out</button>`;

  $("#profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("#profile-name").value.trim();
    if (!name) return toast("Your name can't be empty.");
    try {
      await update(userRef(uid()), { name, updatedAt: now() });
      await updateProfile(state.user, { displayName: name });
      state.profile = { ...state.profile, name };
      toast("Profile updated.");
      renderShell();
    } catch (error) {
      toast(friendlyError(error));
    }
  });
  $("#profile-connect").addEventListener("click", connectModal);
  $("#logout-btn").addEventListener("click", async () => {
    await hangup(false);
    await signOut(auth);
  });
}

function settingsModal() {
  modal(`
    <div class="modal-head"><div><p class="eyebrow">PREFERENCES</p><h2>Settings</h2></div><button class="icon-btn" data-close>×</button></div>
    <div class="settings-row"><div><b>Your account</b><small>${esc(state.user?.email || "")}</small></div></div>
    <div class="settings-row"><div><b>Partner</b><small>${esc(state.partner?.email || "Not connected")}</small></div><button class="text-btn" id="settings-connect">Connect</button></div>
    <button class="danger-btn" id="settings-logout">Sign out</button>
  `);
  $$("[data-close]").forEach(button => button.addEventListener("click", closeModal));
  $("#settings-connect").addEventListener("click", connectModal);
  $("#settings-logout").addEventListener("click", async () => {
    closeModal();
    await hangup(false);
    await signOut(auth);
  });
}

function modal(content) {
  modalRoot.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal-card">${content}</section></div>`;
  $("#modal-backdrop").addEventListener("click", event => {
    if (event.target.id === "modal-backdrop") closeModal();
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function connectModal() {
  modal(`
    <div class="modal-head"><div><p class="eyebrow">MAKE IT TWO</p><h2>Connect your person</h2></div><button class="icon-btn" data-close>×</button></div>
    <p class="muted">Enter the email address they used to create their account in this app.</p>
    <form id="connect-form" class="stack">
      <label>Their account email<input id="partner-email" type="email" required placeholder="their@email.com"></label>
      <button class="primary-btn" id="connect-submit" type="submit">Find and connect</button>
    </form>
    <p class="tiny-note">They must have signed up in this same app using the same Firebase project.</p>
  `);
  $$("[data-close]").forEach(button => button.addEventListener("click", closeModal));
  $("#connect-form").addEventListener("submit", connectPartner);
}

async function connectPartner(event) {
  event.preventDefault();
  const email = cleanEmail($("#partner-email").value);
  if (!email) return;
  if (email === cleanEmail(state.user?.email)) return toast("That's your own email. Enter your person's email.");
  const button = $("#connect-submit");
  setBusy(button, true, "Looking…");

  try {
    let partnerUid = null;

    // Preferred path: direct email index lookup.
    const indexSnapshot = await get(ref(db, `emailIndex/${encodeURIComponent(email)}`));
    if (indexSnapshot.exists()) partnerUid = indexSnapshot.val();

    // Compatibility fallback for accounts created before emailIndex existed.
    if (!partnerUid) {
      const usersSnapshot = await get(ref(db, "users"));
      usersSnapshot.forEach(child => {
        const profile = child.val() || {};
        if (cleanEmail(profile.email) === email) partnerUid = child.key;
      });
    }

    if (!partnerUid) {
      throw new Error("No account with that email was found. Ask them to sign in once, then try again. Check the spelling too.");
    }
    if (partnerUid === uid()) throw new Error("That's your own account.");

    const partnerSnapshot = await get(userRef(partnerUid));
    if (!partnerSnapshot.exists()) throw new Error("That account exists in the email index, but its user profile is missing.");
    const partnerProfile = partnerSnapshot.val() || {};

    const [mineSnapshot, theirsSnapshot] = await Promise.all([
      get(ref(db, `users/${uid()}/partnerUid`)),
      get(ref(db, `users/${partnerUid}/partnerUid`))
    ]);
    const mine = mineSnapshot.val();
    const theirs = theirsSnapshot.val();

    if (mine && mine !== partnerUid) throw new Error("Your account is already connected to someone else. Disconnect first.");
    if (theirs && theirs !== uid()) throw new Error("That person is already connected to another account.");

    const changes = {};
    changes[`users/${uid()}/partnerUid`] = partnerUid;
    changes[`users/${partnerUid}/partnerUid`] = uid();
    changes[`users/${uid()}/updatedAt`] = now();
    changes[`users/${partnerUid}/updatedAt`] = now();
    await update(ref(db), changes);

    state.partner = { uid: partnerUid, ...partnerProfile };
    closeModal();
    toast(`Connected with ${partnerProfile.name || email}.`);
    renderShell();
  } catch (error) {
    console.error("Partner connection failed:", error);
    toast(friendlyError(error), 5500);
  } finally {
    setBusy(button, false);
  }
}

function watchPartner() {
  clearPartnerListener();
  if (!uid()) return;
  state.partnerUnsub = onValue(ref(db, `users/${uid()}/partnerUid`), async snapshot => {
    const partnerUid = snapshot.val();
    if (!partnerUid) {
      state.partner = null;
      if (state.user) renderShell();
      return;
    }
    try {
      const partnerSnapshot = await get(userRef(partnerUid));
      if (!partnerSnapshot.exists()) {
        state.partner = null;
        toast("Your connected profile could not be found.");
      } else {
        state.partner = { uid: partnerUid, ...partnerSnapshot.val() };
      }
      if (state.user) renderShell();
    } catch (error) {
      console.error(error);
      toast(friendlyError(error));
    }
  }, error => toast(friendlyError(error)));
}

async function ensureProfile(user) {
  const profileRef = userRef(user.uid);
  const snapshot = await get(profileRef);
  const email = cleanEmail(user.email);
  let profile = snapshot.val();

  if (!profile) {
    profile = {
      uid: user.uid,
      email,
      name: user.displayName || (email.split("@")[0] || "Me"),
      photoURL: user.photoURL || "",
      partnerUid: null,
      createdAt: now(),
      updatedAt: now()
    };
    await set(profileRef, profile);
  } else {
    profile = {
      ...profile,
      uid: user.uid,
      email: email || profile.email || "",
      name: profile.name || user.displayName || "Me",
      photoURL: profile.photoURL || user.photoURL || ""
    };
    await update(profileRef, {
      email: profile.email,
      name: profile.name,
      photoURL: profile.photoURL,
      updatedAt: now()
    });
  }

  // Keep the lookup index current when this account signs in.
  if (email) await set(ref(db, `emailIndex/${encodeURIComponent(email)}`), user.uid);
  return profile;
}

/* ------------------------- File sharing (Cloudflare Worker) ------------------------- */

function workerUrl() {
  return String(import.meta.env.VITE_R2_WORKER_URL || "").trim().replace(/\/+$/, "");
}

async function uploadFile(file) {
  const base = workerUrl();
  if (!base) throw new Error("File uploads aren't configured yet. Add VITE_R2_WORKER_URL to your build environment.");
  const form = new FormData();
  form.append("file", file);
  form.append("owner", uid());
  const response = await fetch(`${base}/upload`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Upload failed (${response.status}). Check your Cloudflare Worker route.`);
  const result = await response.json();
  const url = result.url || result.publicUrl || (result.key ? `${base}/file/${encodeURIComponent(result.key)}` : "");
  if (!url) throw new Error("The upload service didn't return a file URL.");
  return { url, name: file.name, key: result.key || "" };
}

function openSharedFile(url, name = "Shared file") {
  if (!url) return;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) toast(`Your browser blocked the file window: ${name}`);
}

/* ------------------------------ WebRTC calls ------------------------------ */

function callOverlay(video) {
  const other = state.partner?.name || "Your person";
  const markup = `
    <div class="call-overlay" id="call-overlay">
      <div class="call-top">
        <div><p class="eyebrow">${video ? "VIDEO CALL" : "VOICE CALL"}</p><h2>${esc(other)}</h2><span id="call-timer">Connecting…</span></div>
        <button class="icon-btn" id="end-call" aria-label="End call">×</button>
      </div>
      <div class="call-stage ${video ? "video-stage" : "voice-stage"}">
        <div class="remote-placeholder" id="remote-placeholder">${avatar(state.partner, "call-avatar")}<p>Waiting for ${esc(other)}…</p></div>
        <video id="remote-video" autoplay playsinline class="${video ? "" : "hidden"}"></video>
        <video id="local-video" autoplay muted playsinline class="${video ? "local-preview" : "hidden"}"></video>
      </div>
      <div class="call-controls">
        <button id="mute-btn" class="call-control">Mic on</button>
        ${video ? `<button id="camera-btn" class="call-control">Camera on</button><button id="screen-btn" class="call-control">Share screen</button>` : ""}
        <button id="record-btn" class="call-control">Record</button>
        <button id="hangup-btn" class="hangup-control">End call</button>
      </div>
      <p class="tiny-note">Only record if both people agree. Network restrictions may prevent a call from connecting.</p>
    </div>`;
  modal(markup);
  bindCallButtons();
}

function bindCallButtons() {
  $("#end-call")?.addEventListener("click", () => hangup());
  $("#hangup-btn")?.addEventListener("click", () => hangup());
  $("#mute-btn")?.addEventListener("click", () => {
    const track = state.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $("#mute-btn").textContent = track.enabled ? "Mic on" : "Mic off";
  });
  $("#camera-btn")?.addEventListener("click", () => {
    const track = state.localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $("#camera-btn").textContent = track.enabled ? "Camera on" : "Camera off";
  });
  $("#screen-btn")?.addEventListener("click", toggleScreen);
  $("#record-btn")?.addEventListener("click", () => state.recorder ? stopRecording() : startRecording());
}

async function getMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This device/browser doesn't support microphone access.");
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video ? { facingMode: "user" } : false
  });
}

function makePC(callId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  state.pc = pc;
  state.remoteStream = new MediaStream();

  pc.ontrack = event => {
    event.streams[0]?.getTracks().forEach(track => state.remoteStream.addTrack(track));
    const remoteVideo = $("#remote-video");
    if (remoteVideo) {
      remoteVideo.srcObject = state.remoteStream;
      $("#remote-placeholder")?.classList.add("hidden");
    }
  };

  pc.onicecandidate = event => {
    if (!event.candidate || !state.call) return;
    const side = state.call.role === "caller" ? "callerCandidates" : "calleeCandidates";
    push(ref(db, `callSignals/${callId}/${side}`), event.candidate.toJSON()).catch(console.error);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") startCallTimer();
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      const timer = $("#call-timer");
      if (timer) timer.textContent = "Connection interrupted";
    }
  };

  state.localStream?.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  return pc;
}

async function startCall(video) {
  if (!state.partner) return toast("Connect your person first.");
  if (state.call) return toast("A call is already active.");
  try {
    state.localStream = await getMedia(video);
    const callId = push(ref(db, "callSignals")).key;
    if (!callId) throw new Error("Couldn't create a call ID.");

    state.call = { id: callId, role: "caller", video, startedAt: now() };
    callOverlay(video);
    const localVideo = $("#local-video");
    if (localVideo && video) localVideo.srcObject = state.localStream;

    const pc = makePC(callId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await set(ref(db, `callSignals/${callId}/offer`), {
      type: offer.type,
      sdp: offer.sdp,
      callerUid: uid(),
      callerName: state.profile?.name || "Your person",
      video,
      createdAt: now()
    });
    await set(ref(db, `callSignals/${callId}/inviteeUid`), state.partner.uid);
    await set(ref(db, `callSignals/${callId}/status`), "ringing");

    const historyRef = ref(db, `rooms/${roomId()}/calls/${callId}`);
    await set(historyRef, {
      video,
      startedAt: now(),
      startedBy: uid(),
      status: "calling",
      duration: 0
    });

    state.callUnsubs.push(onValue(ref(db, `callSignals/${callId}/answer`), async snapshot => {
      const answer = snapshot.val();
      if (!answer || !state.pc || state.pc.currentRemoteDescription) return;
      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) { console.warn("Could not set remote answer", error); }
    }));

    state.callUnsubs.push(onChildAdded(ref(db, `callSignals/${callId}/calleeCandidates`), snapshot => {
      if (snapshot.exists() && state.pc) {
        state.pc.addIceCandidate(new RTCIceCandidate(snapshot.val())).catch(error => console.warn(error));
      }
    }));

    state.callUnsubs.push(onValue(ref(db, `callSignals/${callId}/status`), snapshot => {
      if (snapshot.val() === "declined") {
        toast("Your call was declined.");
        hangup(false);
      }
    }));

    toast("Calling…");
  } catch (error) {
    console.error(error);
    toast(friendlyError(error), 5000);
    await cleanupCall();
  }
}

async function answerCall(callId, offerData) {
  if (state.call) return;
  try {
    const video = !!offerData.video;
    state.localStream = await getMedia(video);
    state.call = { id: callId, role: "callee", video, startedAt: now() };
    callOverlay(video);
    if (video && $("#local-video")) $("#local-video").srcObject = state.localStream;

    const pc = makePC(callId);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: offerData.type, sdp: offerData.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await set(ref(db, `callSignals/${callId}/answer`), { type: answer.type, sdp: answer.sdp });
    await set(ref(db, `callSignals/${callId}/status`), "answered");

    state.callUnsubs.push(onChildAdded(ref(db, `callSignals/${callId}/callerCandidates`), snapshot => {
      if (snapshot.exists() && state.pc) {
        state.pc.addIceCandidate(new RTCIceCandidate(snapshot.val())).catch(error => console.warn(error));
      }
    }));
    startCallTimer();
  } catch (error) {
    console.error(error);
    toast(friendlyError(error), 5000);
    await cleanupCall();
  }
}

function watchIncomingCalls() {
  const incomingRef = ref(db, "callSignals");
  const unsubscribe = onChildAdded(incomingRef, async snapshot => {
    const callId = snapshot.key;
    const data = snapshot.val() || {};
    if (data.inviteeUid !== uid() || data.status !== "ringing" || !data.offer || state.call) return;
    if (!window.confirm(`${data.callerName || "Your person"} is calling. Answer?`)) {
      await set(ref(db, `callSignals/${callId}/status`), "declined");
      return;
    }
    await answerCall(callId, data.offer);
  }, error => {
    console.error(error);
    toast(friendlyError(error));
  });
  state.callUnsubs.push(unsubscribe);
}

function startCallTimer() {
  if (state.callTimer) clearInterval(state.callTimer);
  if (!state.callStartedAt) state.callStartedAt = now();
  const updateTimer = () => {
    const target = $("#call-timer");
    if (target) target.textContent = formatDuration((now() - (state.call?.startedAt || state.callStartedAt)) / 1000);
  };
  updateTimer();
  state.callTimer = setInterval(updateTimer, 1000);
}

async function toggleScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return toast("Screen sharing isn't supported in this Android app/browser.");
  }
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = state.screenStream.getVideoTracks()[0];
    const sender = state.pc?.getSenders().find(item => item.track?.kind === "video");
    if (sender) await sender.replaceTrack(track);
    track.onended = async () => {
      const cameraTrack = state.localStream?.getVideoTracks()[0];
      if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
      state.screenStream?.getTracks().forEach(item => item.stop());
      state.screenStream = null;
    };
    toast("Screen sharing started.");
  } catch (error) {
    console.error(error);
    toast("Screen sharing was cancelled or isn't available.");
  }
}

async function startRecording() {
  if (!state.localStream && !state.remoteStream) return toast("There is no active call to record.");
  if (!window.MediaRecorder) return toast("Recording isn't supported on this device.");
  if (!window.confirm("Have both people agreed to record this call?")) return;

  try {
    const tracks = [
      ...(state.localStream?.getTracks() || []),
      ...(state.remoteStream?.getTracks() || [])
    ];
    const combined = new MediaStream(tracks);
    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
    state.recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    state.recordingChunks = [];
    state.recordingCallId = state.call?.id || "call";
    state.recorder.ondataavailable = event => {
      if (event.data?.size) state.recordingChunks.push(event.data);
    };
    state.recorder.onstop = async () => {
      const blob = new Blob(state.recordingChunks, { type: state.recorder?.mimeType || "video/webm" });
      if (!blob.size) return;
      const file = new File([blob], `us-call-${state.recordingCallId}.webm`, { type: blob.type });
      try {
        const uploaded = await uploadFile(file);
        if (state.partner) {
          await push(roomRef("messages"), {
            text: "Call recording",
            fileUrl: uploaded.url,
            fileName: uploaded.name,
            senderUid: uid(),
            senderName: state.profile?.name || "Me",
            createdAt: now()
          });
        }
        toast("Recording uploaded to your shared chat.");
      } catch (error) {
        console.error(error);
        toast(`Recording saved only on this device? Upload failed: ${friendlyError(error)}`, 6000);
        const localUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = localUrl;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(localUrl), 30000);
      }
    };
    state.recorder.start(1000);
    $("#record-btn").textContent = "Stop recording";
    toast("Recording started.");
  } catch (error) {
    console.error(error);
    state.recorder = null;
    toast("Couldn't start recording on this device.");
  }
}

function stopRecording() {
  if (!state.recorder) return;
  const recorder = state.recorder;
  state.recorder = null;
  if (recorder.state !== "inactive") recorder.stop();
  if ($("#record-btn")) $("#record-btn").textContent = "Record";
}

async function hangup(writeStatus = true) {
  const call = state.call;
  if (call && writeStatus) {
    try {
      await set(ref(db, `callSignals/${call.id}/status`), "ended");
      const duration = callStartedDuration();
      await update(ref(db, `rooms/${roomId()}/calls/${call.id}`), {
        status: "ended",
        endedAt: now(),
        duration
      });
    } catch (error) {
      console.warn("Could not update call history", error);
    }
  }
  stopRecording();
  await cleanupCall();
}

function callStartedDuration() {
  return state.call?.startedAt ? Math.floor((now() - state.call.startedAt) / 1000) : 0;
}

async function cleanupCall() {
  state.callUnsubs.forEach(unsubscribe => {
    try { unsubscribe(); } catch {}
  });
  state.callUnsubs = [];
  if (state.callTimer) clearInterval(state.callTimer);
  state.callTimer = null;
  state.callStartedAt = 0;
  [state.localStream, state.remoteStream, state.screenStream].forEach(stream => {
    stream?.getTracks().forEach(track => {
      try { track.stop(); } catch {}
    });
  });
  state.localStream = null;
  state.remoteStream = null;
  state.screenStream = null;
  if (state.pc) {
    try { state.pc.ontrack = null; state.pc.onicecandidate = null; state.pc.close(); } catch {}
  }
  state.pc = null;
  state.call = null;
  closeModal();
}

/* ------------------------------- Startup -------------------------------- */

onAuthStateChanged(auth, async user => {
  state.user = user;
  state.partner = null;
  clearPartnerListener();
  clearTabListeners();

  if (!user) {
    state.profile = null;
    renderAuth();
    return;
  }

  try {
    state.profile = await ensureProfile(user);
    renderShell();
    watchPartner();
    watchIncomingCalls();
  } catch (error) {
    console.error("Could not load profile:", error);
    toast(friendlyError(error), 6000);
    // A permissions problem here usually means the two real UIDs are not
    // in the database rules yet.
    renderShell();
  }
});
