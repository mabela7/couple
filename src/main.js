import "./style.css";
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "firebase/auth";
import {
  ref, set, get, push, onValue, update, remove, serverTimestamp
} from "firebase/database";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const state = {
  user: null, profile: null, partner: null, tab: "home",
  call: null, pc: null, localStream: null, remoteStream: null,
  screenStream: null, recorder: null, chunks: [], callStarted: 0,
  unsub: [], currentFileUrl: null, recording: false
};

const esc = (s="") => String(s).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const initials = (name="U") => name.trim().slice(0,1).toUpperCase();
const toast = (msg) => {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.append(el); }
  el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
};
const path = (p) => ref(db, p);
const uid = () => state.user?.uid;
const roomId = () => [uid(), state.partner?.uid].filter(Boolean).sort().join("_");

function stopListeners() { state.unsub.forEach(fn => fn()); state.unsub = []; }
function listen(p, cb) { const u = onValue(path(p), s => cb(s.val())); state.unsub.push(u); }

function authView() {
  app.innerHTML = `
  <main class="auth-shell">
    <div class="brand-mark">u<span>.</span></div>
    <p class="eyebrow">A LITTLE WORLD FOR TWO</p>
    <h1>Just <em>ours.</em></h1>
    <p class="muted auth-copy">A private place for your conversations, calls and memories.</p>
    <form id="auth-form" class="panel auth-panel">
      <div class="segmented"><button type="button" class="seg active" data-mode="login">Log in</button><button type="button" class="seg" data-mode="signup">Create account</button></div>
      <label>Your name <input id="name" autocomplete="name" placeholder="What should we call you?" /></label>
      <label>Email <input id="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>
      <label>Password <input id="password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters" /></label>
      <button class="primary wide" type="submit" id="auth-submit">Log in <span>↗</span></button>
      <p class="tiny muted">Private access only. Ask your partner to share their account email before connecting.</p>
      <p id="auth-error" class="error"></p>
    </form>
  </main>`;
  let mode = "login";
  const name = $("#name");
  const setMode = m => {
    mode = m; name.parentElement.style.display = m === "signup" ? "grid" : "none";
    $("#auth-submit").innerHTML = (m === "signup" ? "Create account" : "Log in") + " <span>↗</span>";
    document.querySelectorAll(".seg").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
  };
  setMode(mode);
  document.querySelectorAll(".seg").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $("#auth-form").onsubmit = async e => {
    e.preventDefault(); $("#auth-error").textContent = "";
    try {
      const email = $("#email").value.trim(), password = $("#password").value;
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name.value.trim() || email.split("@")[0] });
        await set(path(`users/${cred.user.uid}`), {
          uid: cred.user.uid, name: cred.user.displayName, email,
          createdAt: serverTimestamp(), photoURL: ""
        });
      } else await signInWithEmailAndPassword(auth, email, password);
    } catch (err) { $("#auth-error").textContent = friendlyError(err); }
  };
}
function friendlyError(e) {
  const map = {
    "auth/invalid-credential":"Email or password is incorrect.",
    "auth/email-already-in-use":"That email already has an account.",
    "auth/weak-password":"Use a password with at least 6 characters.",
    "auth/invalid-email":"Enter a valid email address.",
    "auth/too-many-requests":"Too many attempts. Try again later."
  };
  return map[e.code] || e.message || "Something went wrong.";
}

function shell() {
  app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">us<span>.</span></div>
      <div class="top-actions"><span class="privacy"><i></i> PRIVATE SPACE</span><button class="icon-btn" id="settings-btn" aria-label="Settings">⚙</button></div>
    </header>
    <main id="view" class="view"></main>
    <nav class="bottom-nav">
      <button data-tab="home"><b>⌂</b><small>Home</small></button>
      <button data-tab="messages"><b>♡</b><small>Chat</small></button>
      <button data-tab="calls"><b>◉</b><small>Calls</small></button>
      <button data-tab="memories"><b>▧</b><small>Memories</small></button>
      <button data-tab="profile"><b>◌</b><small>You</small></button>
    </nav>
  </div>
  <div id="modal-root"></div><div id="toast"></div>`;
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderTab(); });
  $("#settings-btn").onclick = () => settingsModal();
  watchPartner();
  renderTab();
}
function header(title, sub="") { return `<div class="section-head"><div><p class="eyebrow">${esc(sub)}</p><h1>${esc(title)}</h1></div></div>`; }
function renderTab() {
  state.unsub.splice(1).forEach(fn => fn());
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
  const v = $("#view"); if (!v) return;
  if (state.tab === "home") homeView(v);
  if (state.tab === "messages") messagesView(v);
  if (state.tab === "calls") callsView(v);
  if (state.tab === "memories") memoriesView(v);
  if (state.tab === "profile") profileView(v);
}
function watchPartner() {
  listen("couple/partnerUid", async partnerUid => {
    if (!partnerUid || partnerUid === uid()) { state.partner = null; renderTab(); return; }
    const snap = await get(path(`users/${partnerUid}`));
    state.partner = snap.val(); renderTab();
  });
}
function homeView(v) {
  v.innerHTML = `${header("Your little world", "GOOD TO HAVE YOU HERE")}
    <section class="welcome-card">
      <div class="welcome-glow"></div><p class="eyebrow">JUST THE TWO OF YOU</p>
      <h2>Somewhere to<br/><em>keep everything.</em></h2>
      <p>Moments, long conversations, silly photos and all the little things.</p>
      <div class="welcome-actions"><button class="primary" id="home-chat">Send a message ↗</button><button class="soft" id="home-call">Start a call</button></div>
    </section>
    <div class="quick-grid">
      <button class="quick-card" data-go="messages"><span>♡</span><b>Our chat</b><small>Little notes, anytime</small></button>
      <button class="quick-card" data-go="calls"><span>◉</span><b>Call each other</b><small>Hear or see each other</small></button>
      <button class="quick-card" data-go="memories"><span>▧</span><b>Our memories</b><small>Everything worth keeping</small></button>
      <button class="quick-card" data-go="profile"><span>＋</span><b>Connect partner</b><small>Make this space yours</small></button>
    </div>
    <div class="inline-note">${state.partner ? `<span class="online-dot"></span> Connected with <b>${esc(state.partner.name || "your partner")}</b>` : `Your space is ready. Connect your partner in your profile to get started.`}</div>
    <section class="feed-section"><div class="row-between"><h3>Little moments</h3><span class="muted tiny">SHARED FEED</span></div><div id="feed-list" class="feed-list"></div></section>`;
  $("#home-chat").onclick = () => go("messages"); $("#home-call").onclick = () => go("calls");
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  loadFeed();
}
function go(tab) { state.tab = tab; renderTab(); }
async function loadFeed() {
  listen(`posts/${roomId()}`, data => {
    const el = $("#feed-list"); if (!el) return;
    const items = Object.entries(data || {}).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
    el.innerHTML = items.length ? items.map(([id,p]) => `<article class="post panel"><div class="post-top"><div class="avatar">${initials(p.authorName)}</div><div><b>${esc(p.authorName)}</b><small>${new Date(p.createdAt||Date.now()).toLocaleString()}</small></div></div><p>${esc(p.text||"")}</p>${p.fileKey ? `<button class="text-link" data-file="${esc(p.fileKey)}" data-name="${esc(p.fileName||"Shared file")}">Open attachment ↗</button>`:""}</article>`).join("") : `<div class="empty panel"><span>✧</span><b>Your story starts here</b><p>Share a little moment with each other.</p><button class="soft" id="first-post">Write a post</button></div>`;
    $("#first-post")?.addEventListener("click", postModal);
    document.querySelectorAll("[data-file]").forEach(b => b.onclick = () => openSharedFile(b.dataset.file,b.dataset.name));
  });
}
function messagesView(v) {
  v.innerHTML = `${header("Our chat", "A QUIET CORNER FOR TWO")}
  <div class="chat-panel panel"><div class="chat-person"><div class="avatar large">${initials(state.partner?.name || "?")}</div><div><b>${esc(state.partner?.name || "Your person")}</b><small>${state.partner ? "Your private conversation" : "Connect your partner first"}</small></div><button class="round-call" id="chat-call">◉</button></div><div id="messages-list" class="messages-list"><div class="muted center">Loading messages…</div></div><form id="message-form" class="message-form"><input id="message-input" placeholder="Write something sweet…" autocomplete="off"/><button class="send-btn" aria-label="Send">↑</button></form></div>`;
  $("#chat-call").onclick = () => startCall("video");
  listen(`messages/${roomId()}`, data => {
    const el = $("#messages-list"); if (!el) return;
    const msgs = Object.entries(data||{}).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
    el.innerHTML = msgs.length ? msgs.map(([id,m]) => `<div class="bubble-row ${m.uid===uid()?"mine":""}"><div class="bubble">${esc(m.text)}<small>${new Date(m.createdAt||Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div></div>`).join("") : `<div class="empty-chat">No messages yet. Say hello ♡</div>`;
    el.scrollTop = el.scrollHeight;
  });
  $("#message-form").onsubmit = async e => {
    e.preventDefault(); const text = $("#message-input").value.trim(); if (!text) return;
    if (!state.partner) return toast("Connect your partner first.");
    await push(path(`messages/${roomId()}`), { uid:uid(), name:state.profile?.name, text, createdAt:Date.now() });
    $("#message-input").value = "";
  };
}
function callsView(v) {
  v.innerHTML = `${header("Be close, anywhere", "YOUR CALL SPACE")}
  <section class="call-hero"><div class="call-orbit">♡</div><p class="eyebrow">A LITTLE CLOSER</p><h2>Call your<br/><em>favorite person.</em></h2><p>Private one-to-one audio and video calls.</p><div class="call-buttons"><button class="primary" id="video-call">▣ Video call</button><button class="soft" id="audio-call">♩ Audio call</button></div></section>
  <div class="row-between subhead"><h3>Recent calls</h3><span class="tiny muted">CALL HISTORY</span></div><div id="call-history" class="history-list"></div>
  <div id="incoming-call"></div>`;
  $("#video-call").onclick = () => startCall("video"); $("#audio-call").onclick = () => startCall("audio");
  listen(`calls/${roomId()}`, data => {
    const el = $("#call-history"); if (!el) return;
    const arr = Object.entries(data||{}).sort((a,b)=>(b[1].startedAt||0)-(a[1].startedAt||0));
    el.innerHTML = arr.length ? arr.map(([id,c]) => `<div class="history-item panel"><div class="history-icon">${c.type==="video"?"▣":"♩"}</div><div class="history-info"><b>${c.caller===uid()?"Outgoing":"Incoming"} ${c.type} call</b><small>${new Date(c.startedAt||Date.now()).toLocaleString()}</small></div><span class="duration">${formatDuration(c.duration||0)}</span></div>`).join("") : `<div class="empty panel"><span>◉</span><b>No calls yet</b><p>Your call memories will appear here.</p></div>`;
  });
  listen(`callInvites/${uid()}`, invite => {
    const el=$("#incoming-call"); if(!el) return;
    if (!invite || invite.status !== "ringing") { el.innerHTML=""; return; }
    el.innerHTML=`<div class="incoming panel"><div><b>Incoming ${invite.type} call</b><small>${esc(invite.fromName||"Your partner")} is calling…</small></div><button class="primary" id="answer-call">Answer</button><button class="soft" id="decline-call">Decline</button></div>`;
    $("#answer-call").onclick=()=>answerCall(invite); $("#decline-call").onclick=()=>update(path(`callInvites/${uid()}`),{status:"declined"});
  });
}
function memoriesView(v) {
  v.innerHTML = `${header("Our memories", "THE THINGS WE KEEP")}
  <div class="memory-tabs"><span>All moments</span><span>Call recordings</span><span>Shared files</span></div>
  <div id="memory-list" class="memory-grid"></div>
  <button class="floating-add" id="upload-memory">＋</button>`;
  listen(`memories/${roomId()}`, data => {
    const el=$("#memory-list"); if(!el)return;
    const items=Object.entries(data||{}).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
    el.innerHTML=items.length?items.map(([id,m])=>`<button class="memory-tile" data-key="${esc(m.fileKey||"")}" data-name="${esc(m.name||"Memory")}"><div class="memory-thumb">${m.kind==="recording"?"▶":m.kind==="image"?"▧":"↗"}</div><b>${esc(m.name||"Untitled")}</b><small>${new Date(m.createdAt||Date.now()).toLocaleDateString()}</small></button>`).join(""):`<div class="empty panel full"><span>✧</span><b>Your memories live here</b><p>Share a file or save a call recording to start your gallery.</p></div>`;
    document.querySelectorAll(".memory-tile").forEach(b=>b.onclick=()=>openSharedFile(b.dataset.key,b.dataset.name));
  });
  $("#upload-memory").onclick=()=>uploadFile("memory");
}
function profileView(v) {
  v.innerHTML = `${header("Your space", "ACCOUNT & CONNECTION")}
  <section class="profile-card panel"><div class="avatar huge">${initials(state.profile?.name||"U")}</div><h2>${esc(state.profile?.name||"You")}</h2><p class="muted">${esc(state.user?.email||"")}</p><span class="privacy-pill">PRIVATE ACCOUNT</span></section>
  <section class="panel settings-list"><div class="row-between"><div><b>Your partner</b><small>${state.partner?esc(state.partner.name):"Not connected yet"}</small></div><span>♡</span></div><button class="soft wide" id="connect-partner">${state.partner?"Change partner connection":"Connect partner"}</button><div class="divider"></div><div class="row-between"><div><b>Account</b><small>Signed in securely with Firebase</small></div></div><button class="danger wide" id="logout">Log out</button></section>
  <p class="tiny muted center">This space is designed for two accounts. Never share your Firebase admin credentials.</p>`;
  $("#connect-partner").onclick=connectModal;
  $("#logout").onclick=()=>signOut(auth);
}
function settingsModal() {
  $("#modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal panel"><button class="modal-close" id="close-modal">×</button><p class="eyebrow">YOUR SPACE</p><h2>Privacy first.</h2><p class="muted">Only the two approved Firebase accounts should have access. Configure database rules before using real personal content.</p><button class="soft wide" id="go-profile">Manage connection</button></div></div>`;
  $("#close-modal").onclick=closeModal; $("#go-profile").onclick=()=>{closeModal();go("profile");};
}
function closeModal(){ $("#modal-root").innerHTML=""; }
function connectModal() {
  $("#modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal panel"><button class="modal-close" id="close-modal">×</button><p class="eyebrow">MAKE IT YOURS</p><h2>Connect your person.</h2><p class="muted">Ask your partner to create an account first, then enter the exact email they used.</p><form id="connect-form"><label>Partner's email<input id="partner-email" type="email" required placeholder="partner@example.com"/></label><button class="primary wide">Connect accounts ↗</button></form><p class="tiny muted">The partner must sign in at least once before they can be found.</p></div></div>`;
  $("#close-modal").onclick=closeModal;
  $("#connect-form").onsubmit=async e=>{
    e.preventDefault();
    try{
      const email=$("#partner-email").value.trim().toLowerCase();
      const users=await get(path("users"));
      let found=null; users.forEach(s=>{if((s.val()?.email||"").toLowerCase()===email)found=s.val();});
      if(!found||found.uid===uid())return toast("Couldn't find that partner account.");
      const updates={}; updates[`couple/partnerUid`]=found.uid; updates[`users/${uid()}/partnerUid`]=found.uid; updates[`users/${found.uid}/partnerUid`]=uid();
      await update(path(""),updates);
      closeModal();toast("You are connected ♡");
    }catch(err){toast(friendlyError(err));}
  };
}
function postModal(){
  $("#modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal panel"><button class="modal-close" id="close-modal">×</button><p class="eyebrow">A LITTLE MOMENT</p><h2>Share something.</h2><form id="post-form"><label>Your note<textarea id="post-text" rows="4" placeholder="Something worth remembering…"></textarea></label><button class="primary wide">Share with us ↗</button></form></div></div>`;
  $("#close-modal").onclick=closeModal;
  $("#post-form").onsubmit=async e=>{e.preventDefault();const text=$("#post-text").value.trim();if(!text)return;await push(path(`posts/${roomId()}`),{uid:uid(),authorName:state.profile?.name,text,createdAt:Date.now()});closeModal();toast("Shared ♡");};
}
function formatDuration(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return h?`${h}h ${m}m`:`${m}m ${sec}s`;}
function callOverlay(title, status="Connecting…") {
  $("#modal-root").innerHTML=`<div class="call-overlay"><div class="call-top"><span class="privacy-pill">PRIVATE CALL</span><button id="end-call" class="end-top">End ×</button></div><div class="call-videos"><video id="remote-video" autoplay playsinline></video><video id="local-video" autoplay muted playsinline></video></div><div class="call-caption"><p class="eyebrow">${esc(status)}</p><h2>${esc(title)}</h2><div id="call-timer">00:00</div></div><div class="call-controls"><button id="mute-btn">Mic on</button><button id="camera-btn">Camera on</button><button id="screen-btn">Share screen</button><button id="record-btn">Record</button><button id="hangup-btn" class="hangup">End call</button></div><p class="tiny muted call-footnote">Record only with both people's knowledge and consent.</p></div>`;
  $("#end-call").onclick=hangup; $("#hangup-btn").onclick=hangup;
}
async function getMedia(type){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera/microphone access is unavailable in this browser or WebView.");
  return navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"?{facingMode:"user"}:false});
}
function makePC(callId, isCaller){
  const pc=new RTCPeerConnection({iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun1.l.google.com:19302"}
  ]});
  state.pc=pc;
  pc.onicecandidate=e=>{if(e.candidate){const side=isCaller?"caller":"callee";push(path(`callSignals/${callId}/${side}Candidates`),e.candidate.toJSON());}};
  pc.ontrack=e=>{
    if(!state.remoteStream)state.remoteStream=new MediaStream();
    state.remoteStream.addTrack(e.track);
    const rv=$("#remote-video");if(rv){rv.srcObject=state.remoteStream;rv.play().catch(()=>{});}
  };
  pc.onconnectionstatechange=()=>{if(["failed","disconnected"].includes(pc.connectionState))toast("Connection interrupted. Try calling again.");};
  return pc;
}
async function startCall(type){
  if(!state.partner)return toast("Connect your partner first.");
  try{
    state.localStream=await getMedia(type);state.remoteStream=new MediaStream();
    const id=push(path("calls")).key, startedAt=Date.now();
    state.call={id,type,caller:uid(),receiver:state.partner.uid,startedAt};
    state.callStarted=Date.now();state.pc=makePC(id,true);
    state.localStream.getTracks().forEach(t=>state.pc.addTrack(t,state.localStream));
    const offer=await state.pc.createOffer();await state.pc.setLocalDescription(offer);
    await set(path(`calls/${roomId()}/${id}`),{...state.call,status:"ringing"});
    await set(path(`callSignals/${id}/offer`),{type:offer.type,sdp:offer.sdp});
    await set(path(`callInvites/${state.partner.uid}`),{id,type,from:uid(),fromName:state.profile?.name,status:"ringing",startedAt});
    callOverlay(state.partner.name||"Your person","Calling…");attachLocal();
    watchAnswer(id);
    startTimer();
  }catch(e){toast(e.message);cleanupCall();}
}
function watchAnswer(id){
  const u=onValue(path(`callSignals/${id}/answer`),async s=>{
    if(!s.val()||!state.pc||state.pc.currentRemoteDescription)return;
    await state.pc.setRemoteDescription(s.val());});
  state.unsub.push(u);
  const c=onValue(path(`callSignals/${id}/calleeCandidates`),s=>s.forEach(x=>state.pc?.addIceCandidate(x.val()).catch(()=>{})));
  state.unsub.push(c);
}
async function answerCall(invite){
  try{
    state.localStream=await getMedia(invite.type);state.remoteStream=new MediaStream();
    state.call={id:invite.id,type:invite.type,caller:invite.from,receiver:uid(),startedAt:invite.startedAt};
    state.callStarted=Date.now();state.pc=makePC(invite.id,false);
    state.localStream.getTracks().forEach(t=>state.pc.addTrack(t,state.localStream));
    const offerSnap=await get(path(`callSignals/${invite.id}/offer`));
    await state.pc.setRemoteDescription(offerSnap.val());
    const answer=await state.pc.createAnswer();await state.pc.setLocalDescription(answer);
    await set(path(`callSignals/${invite.id}/answer`),{type:answer.type,sdp:answer.sdp});
    await update(path(`calls/${roomId()}/${invite.id}`),{status:"active"});
    await update(path(`callInvites/${uid()}`),{status:"answered"});
    callOverlay(state.partner?.name||"Your person","Connected");attachLocal();
    const c=onValue(path(`callSignals/${invite.id}/callerCandidates`),s=>s.forEach(x=>state.pc?.addIceCandidate(x.val()).catch(()=>{})));
    state.unsub.push(c);startTimer();
  }catch(e){toast(e.message);cleanupCall();}
}
function attachLocal(){const el=$("#local-video");if(el&&state.localStream){el.srcObject=state.localStream;el.play().catch(()=>{});}}
function startTimer(){const timer=$("#call-timer");if(!timer)return;const tick=()=>{if(!state.call)return;timer.textContent=formatDuration(Math.floor((Date.now()-state.callStarted)/1000));};tick();state.timer=setInterval(tick,1000);}
async function hangup(){
  if(!state.call)return cleanupCall();
  const c=state.call,duration=Math.floor((Date.now()-state.callStarted)/1000);
  try{
    await update(path(`calls/${roomId()}/${c.id}`),{status:"ended",endedAt:Date.now(),duration});
    await update(path(`callInvites/${c.receiver}`),{status:"ended"});
    await update(path(`callInvites/${c.caller}`),{status:"ended"});
  }catch(e){}
  if(state.recording)await stopRecording(true);
  cleanupCall();toast(`Call saved · ${formatDuration(duration)}`);
}
function cleanupCall(){
  if(state.timer)clearInterval(state.timer);
  state.pc?.close();state.pc=null;
  [state.localStream,state.remoteStream,state.screenStream].forEach(s=>s?.getTracks().forEach(t=>t.stop()));
  state.localStream=null;state.remoteStream=null;state.screenStream=null;state.call=null;state.recording=false;
  $("#modal-root").innerHTML="";
}
async function toggleScreen(){
  if(!navigator.mediaDevices?.getDisplayMedia)return toast("Screen sharing is not supported in this Android WebView. Use a supported desktop browser for now.");
  try{
    state.screenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    const track=state.screenStream.getVideoTracks()[0];
    const sender=state.pc?.getSenders().find(s=>s.track?.kind==="video");
    if(sender)await sender.replaceTrack(track);
    else state.pc?.addTrack(track,state.screenStream);
    const lv=$("#local-video");if(lv)lv.srcObject=state.screenStream;
    track.onended=()=>{const cam=state.localStream?.getVideoTracks()[0];const s=state.pc?.getSenders().find(x=>x.track?.kind==="video");if(s&&cam)s.replaceTrack(cam);attachLocal();};
  }catch(e){toast("Screen sharing cancelled or unavailable.");}
}
function bindCallButtons(){
  $("#mute-btn")?.addEventListener("click",()=>{const t=state.localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$("#mute-btn").textContent=t.enabled?"Mic on":"Mic off";}});
  $("#camera-btn")?.addEventListener("click",()=>{const t=state.localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$("#camera-btn").textContent=t.enabled?"Camera on":"Camera off";}});
  $("#screen-btn")?.addEventListener("click",toggleScreen);
  $("#record-btn")?.addEventListener("click",startRecording);
}
const oldCallOverlay=callOverlay;
callOverlay=function(...args){oldCallOverlay(...args);bindCallButtons();};
async function startRecording(){
  if(!state.call||state.recording)return;
  const tracks=[...(state.localStream?.getTracks()||[]),...(state.remoteStream?.getTracks()||[])];
  const combined=new MediaStream(tracks);
  const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)return toast("Recording format isn't supported on this device.");
  state.chunks=[];state.recorder=new MediaRecorder(combined,{mimeType:mime});
  state.recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data);};
  state.recorder.onstop=async()=>{const blob=new Blob(state.chunks,{type:mime});await uploadBlob(blob,`call-${state.call?.id||Date.now()}.webm`,"recording");};
  state.recorder.start(1000);state.recording=true;$("#record-btn").textContent="Recording…";
  toast("Recording started. Make sure both of you agree.");
}
async function stopRecording(){
  if(state.recorder&&state.recorder.state!=="inactive"){state.recorder.stop();}
  state.recording=false;
}
async function uploadBlob(blob,name,kind){
  try{
    const key=`${roomId()}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const token=await state.user.getIdToken();
    const worker=import.meta.env.VITE_R2_WORKER_URL;
    if(!worker)throw new Error("Set VITE_R2_WORKER_URL to your private Cloudflare Worker URL.");
    const res=await fetch(`${worker}/upload/${encodeURIComponent(key)}`,{method:"PUT",headers:{"Authorization":`Bearer ${token}`,"Content-Type":blob.type||"application/octet-stream"},body:blob});
    if(!res.ok)throw new Error(await res.text());
    const meta={key,name,kind,createdAt:Date.now(),by:uid(),mime:blob.type||"application/octet-stream"};
    await push(path(`memories/${roomId()}`),meta);
    toast("Saved to your memories ♡");
  }catch(e){toast(`Upload failed: ${e.message}`);}
}
async function uploadFile(kind="file"){
  const input=document.createElement("input");input.type="file";input.accept="image/*,video/*,.pdf,.doc,.docx,.txt";
  input.onchange=async()=>{const file=input.files?.[0];if(!file)return;if(file.size>100*1024*1024)return toast("Keep files under 100 MB for now.");
    await uploadBlob(file,file.name,file.type.startsWith("image/")?"image":kind==="memory"?"file":"file");
  };input.click();
}
async function openSharedFile(key,name){
  if(!key)return toast("This item has no stored file.");
  try{
    const token=await state.user.getIdToken(),worker=import.meta.env.VITE_R2_WORKER_URL;
    const res=await fetch(`${worker}/file/${encodeURIComponent(key)}`,{headers:{"Authorization":`Bearer ${token}`}});
    if(!res.ok)throw new Error("Could not open this file.");
    const blob=await res.blob(),url=URL.createObjectURL(blob);state.currentFileUrl=url;
    $("#modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal panel file-modal"><button class="modal-close" id="close-modal">×</button><p class="eyebrow">SHARED WITH LOVE</p><h2>${esc(name)}</h2><div id="file-preview"></div><a class="primary wide download-link" href="${url}" download="${esc(name)}">Download / open file ↗</a></div></div>`;
    const preview=$("#file-preview");
    if(blob.type.startsWith("image/"))preview.innerHTML=`<img class="file-image" src="${url}"/>`;
    else if(blob.type.startsWith("video/"))preview.innerHTML=`<video class="file-video" src="${url}" controls playsinline></video>`;
    else if(blob.type==="application/pdf")preview.innerHTML=`<iframe class="pdf-frame" src="${url}"></iframe>`;
    else preview.innerHTML=`<p class="muted">Preview isn't available for this file type. Use the button below to open it.</p>`;
    $("#close-modal").onclick=()=>{closeModal();URL.revokeObjectURL(url);};
  }catch(e){toast(e.message);}
}

onAuthStateChanged(auth, async user=>{
  stopListeners();
  if(!user){state.user=null;authView();return;}
  state.user=user;
  const snap=await get(path(`users/${user.uid}`));
  state.profile=snap.val()||{uid:user.uid,name:user.displayName||user.email.split("@")[0],email:user.email};
  if(!snap.exists())await set(path(`users/${user.uid}`),state.profile);
  shell();
});
