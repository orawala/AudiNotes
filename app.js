// ---------------------------------------------------------------------------
// AudiNotes — app logic
// ---------------------------------------------------------------------------

// Application state
let supabaseClient = null;
let currentUser = null;
let notes = [];
let projects = [];
let activeFilter = 'all';
let activeProjectId = null;
let searchQuery = '';
let playingId = null;

// Recording state
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;
let recordedBlob = null;
let recordedDuration = 0;
let speechRecognition = null;
let liveTranscript = '';

// DOM references
const $ = (id) => document.getElementById(id);
const sidebar = $('sidebar');
const sidebarScrim = $('sidebarScrim');
const mobileMenu = $('mobileMenu');
const notesGrid = $('notesGrid');
const notesCount = $('notesCount');
const allCount = $('allCount');
const projectList = $('projectList');
const searchInput = $('searchInput');
const currentCrumb = $('currentCrumb');
const pageTitle = $('pageTitle');

const persistentPlayer = $('persistentPlayer');
const playerTitle = $('playerTitle');
const playerSub = $('playerSub');
const globalAudioPlayer = $('globalAudioPlayer');

const startRecordBtn = $('startRecordBtn');
const stopRecordBtn = $('stopRecordBtn');
const recordOrb = $('recordOrb');
const recordTime = $('recordTime');
const recordState = $('recordState');
const saveAudioBtn = $('saveAudioBtn');

const FILTER_LABELS = { all: 'All notes', text: 'Text notes', voice: 'Voice notes' };
const START_LABEL = '<span>●</span> Start recording';
const MOBILE_QUERY = window.matchMedia('(max-width: 720px)');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return str ? String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '';
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const findNote = (id) => notes.find((n) => sameId(n.id, id));
const findProject = (id) => projects.find((p) => sameId(p.id, id));

function setHeading(text) {
  if (currentCrumb) currentCrumb.textContent = text;
  if (pageTitle && pageTitle.childNodes[0]) pageTitle.childNodes[0].nodeValue = text;
}

function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Mobile sidebar
// ---------------------------------------------------------------------------
function setSidebar(open) {
  sidebar?.classList.toggle('open', open);
  sidebarScrim?.classList.toggle('visible', open);
  mobileMenu?.setAttribute('aria-expanded', String(open));
  mobileMenu?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

mobileMenu?.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
sidebarScrim?.addEventListener('click', () => setSidebar(false));
MOBILE_QUERY.addEventListener('change', (e) => { if (!e.matches) setSidebar(false); });

// ---------------------------------------------------------------------------
// Speech recognition (live transcript while recording)
// ---------------------------------------------------------------------------
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;

  speechRecognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        liveTranscript += event.results[i][0].transcript + ' ';
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    const field = $('transcriptText');
    if (field) field.value = (liveTranscript + interim).trim();
  };
}

// ---------------------------------------------------------------------------
// Auth + data
// ---------------------------------------------------------------------------
window.addEventListener('audionotes-auth-changed', (event) => {
  currentUser = event.detail.user;
  supabaseClient = event.detail.client;

  if (currentUser && supabaseClient) {
    fetchWorkspaceData();
  } else {
    closePlayer();
    notes = [];
    projects = [];
    renderProjects();
    renderNotes();
  }
});

async function fetchWorkspaceData() {
  if (!supabaseClient || !currentUser) return;

  const { data: fetchProjects, error: pErr } = await supabaseClient
    .from('projects')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });

  if (!pErr && fetchProjects) projects = fetchProjects;

  const { data: fetchNotes, error: nErr } = await supabaseClient
    .from('notes')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (!nErr && fetchNotes) {
    notes = fetchNotes.map((n) => {
      let audioUrl = null;
      if (n.storage_path) {
        const { data } = supabaseClient.storage.from('notes_audio').getPublicUrl(n.storage_path);
        audioUrl = data?.publicUrl || null;
      }
      return { ...n, audio_url: audioUrl };
    });
  }

  renderProjects();
  renderNotes();
}

// ---------------------------------------------------------------------------
// Sidebar: projects + filters
// ---------------------------------------------------------------------------
function renderProjects() {
  if (!projectList) return;
  projectList.innerHTML = projects.map((p) => `
    <button class="project-item ${sameId(activeProjectId, p.id) ? 'active' : ''}" data-project-id="${escapeHtml(p.id)}" type="button">
      <span class="project-color"></span>
      <span class="project-name">${escapeHtml(p.name)}</span>
    </button>
  `).join('');
}

projectList?.addEventListener('click', (e) => {
  const item = e.target.closest('[data-project-id]');
  if (!item) return;
  const project = findProject(item.dataset.projectId);
  if (!project) return;

  activeProjectId = project.id;
  setHeading(project.name);
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  renderProjects();
  renderNotes();
  setSidebar(false);
});

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    activeProjectId = null;
    setHeading(FILTER_LABELS[activeFilter] || 'All notes');
    renderProjects();
    renderNotes();
    setSidebar(false);
  });
});

$('crumbWorkspace')?.addEventListener('click', () => {
  activeFilter = 'all';
  activeProjectId = null;
  setHeading(FILTER_LABELS.all);
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  document.querySelector('.nav-item[data-filter="all"]')?.classList.add('active');
  renderProjects();
  renderNotes();
});

// ---------------------------------------------------------------------------
// Notes grid
// ---------------------------------------------------------------------------
function renderNotes() {
  if (!notesGrid) return;

  let filtered = notes.filter((n) => {
    if (activeProjectId) return sameId(n.project_id, activeProjectId);
    if (activeFilter === 'text') return n.type === 'text';
    if (activeFilter === 'voice') return n.type === 'voice';
    return true;
  });

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((n) =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.body && n.body.toLowerCase().includes(q)) ||
      (n.transcript && n.transcript.toLowerCase().includes(q))
    );
  }

  if (allCount) allCount.textContent = notes.length;
  if (notesCount) notesCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;

  if (filtered.length === 0) {
    notesGrid.innerHTML = searchQuery
      ? `<div class="empty-state visible">
           <h2>No matches</h2>
           <p>Nothing matches “${escapeHtml(searchQuery)}”. Try a different word or clear the search.</p>
         </div>`
      : `<div class="empty-state visible">
           <h2>Nothing here yet</h2>
           <p>Write a note or record your voice and it will show up here.</p>
           <div class="empty-actions">
             <button class="secondary-button" data-action="new-text" type="button">＋ Text note</button>
             <button class="primary-button" data-action="new-voice" type="button">● Record voice</button>
           </div>
         </div>`;
    return;
  }

  notesGrid.innerHTML = filtered.map((n) => `
    <div class="note-card" data-id="${escapeHtml(n.id)}" tabindex="0" aria-label="Open note: ${escapeHtml(n.title)}">
      <div class="note-card-top">
        <span class="type-pill ${escapeHtml(n.type)}">${escapeHtml(n.type)}</span>
      </div>
      <h3>${escapeHtml(n.title)}</h3>
      <p class="note-excerpt">${escapeHtml(n.body || n.transcript || 'No content provided.')}</p>

      <div class="note-card-bottom">
        <span class="note-date">${formatDate(n.updated_at || n.created_at)}</span>
        <div class="note-actions">
          ${n.audio_url ? '<button class="action-btn play-btn" data-action="play" type="button">▶ Play</button>' : ''}
          <button class="action-btn edit-btn" data-action="edit" type="button">✎ Edit</button>
          <button class="action-btn delete-btn" data-action="delete" type="button">✕ Delete</button>
        </div>
      </div>
    </div>
  `).join('');

  syncPlayState();
}

// One delegated listener for every card button and for the card itself
notesGrid?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  const action = actionEl?.dataset.action;

  if (action === 'new-text') return openNewTextNote();
  if (action === 'new-voice') return showModal('voiceModal');

  const card = e.target.closest('.note-card');
  if (!card) return;
  const id = card.dataset.id;

  if (action === 'play') return togglePlayback(id);
  if (action === 'delete') return deleteNote(id);
  openEditModal(id); // "edit" button or a click anywhere else on the card
});

notesGrid?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('note-card')) openEditModal(e.target.dataset.id);
});

// ---------------------------------------------------------------------------
// Bottom player
// ---------------------------------------------------------------------------
function syncPlayState() {
  document.querySelectorAll('.note-card').forEach((card) => {
    const isCurrent = sameId(card.dataset.id, playingId);
    const isPlaying = isCurrent && !globalAudioPlayer.paused;
    card.classList.toggle('playing', isCurrent);
    const btn = card.querySelector('.play-btn');
    if (btn) btn.textContent = isPlaying ? '❚❚ Pause' : '▶ Play';
  });
}

function togglePlayback(id) {
  const note = findNote(id);
  if (!note || !note.audio_url) return;

  if (sameId(playingId, id)) {
    if (globalAudioPlayer.paused) globalAudioPlayer.play().catch(() => {});
    else globalAudioPlayer.pause();
    return;
  }

  playingId = note.id;
  playerTitle.textContent = note.title || 'Voice note';
  playerSub.textContent = findProject(note.project_id)?.name || 'Voice note';
  globalAudioPlayer.src = note.audio_url;
  persistentPlayer.classList.remove('hidden');
  document.body.classList.add('player-open');
  globalAudioPlayer.play().catch(() => {});
  syncPlayState();
}

function closePlayer() {
  globalAudioPlayer.pause();
  globalAudioPlayer.removeAttribute('src');
  globalAudioPlayer.load();
  playingId = null;
  persistentPlayer.classList.add('hidden');
  document.body.classList.remove('player-open');
  syncPlayState();
}

$('playerCloseBtn')?.addEventListener('click', closePlayer);
['play', 'pause', 'ended'].forEach((evt) => globalAudioPlayer.addEventListener(evt, syncPlayState));
globalAudioPlayer.addEventListener('error', () => {
  if (globalAudioPlayer.getAttribute('src')) showToast('Couldn’t play this recording. Check your connection and try again.');
});

// ---------------------------------------------------------------------------
// Note editor
// ---------------------------------------------------------------------------
function openNewTextNote() {
  $('noteId').value = '';
  $('noteTitle').value = '';
  $('noteBody').value = '';
  $('modalTranscript').value = '';
  $('modalTranscriptSection').classList.add('hidden');
  $('modalTitle').textContent = 'New note';
  showModal('noteModal');
}

function openEditModal(id) {
  const note = findNote(id);
  if (!note) return;

  $('noteId').value = note.id;
  $('noteTitle').value = note.title || '';
  $('noteBody').value = note.body || '';
  $('modalTitle').textContent = 'Edit note';

  const transcriptSec = $('modalTranscriptSection');
  if (note.type === 'voice') {
    transcriptSec.classList.remove('hidden');
    $('modalTranscript').value = note.transcript || '';
  } else {
    transcriptSec.classList.add('hidden');
  }

  showModal('noteModal');
}

$('saveNoteBtn')?.addEventListener('click', async (e) => {
  if (!supabaseClient || !currentUser) {
    showToast('You’re signed out. Sign in again to save.');
    return;
  }

  const btn = e.currentTarget;
  const id = $('noteId').value;
  const title = $('noteTitle').value.trim() || 'Untitled note';
  const body = $('noteBody').value;
  const transcript = $('modalTranscript')?.value || '';

  btn.disabled = true;
  try {
    if (id) {
      const { error } = await supabaseClient.from('notes').update({
        title,
        body,
        transcript,
        updated_at: new Date().toISOString()
      }).eq('id', id);

      if (error) throw error;
      showToast('Note saved');
    } else {
      const { error } = await supabaseClient.from('notes').insert({
        user_id: currentUser.id,
        title,
        body,
        type: 'text',
        project_id: activeProjectId
      });

      if (error) throw error;
      showToast('Note created');
    }
  } catch (err) {
    showToast('Couldn’t save the note: ' + err.message);
    btn.disabled = false;
    return;
  }

  btn.disabled = false;
  hideModal('noteModal');
  fetchWorkspaceData();
});

async function deleteNote(id) {
  if (!confirm('Delete this note? This can’t be undone.')) return;
  const note = findNote(id);

  if (sameId(playingId, id)) closePlayer();

  if (note && note.storage_path) {
    await supabaseClient.storage.from('notes_audio').remove([note.storage_path]);
  }

  const { error } = await supabaseClient.from('notes').delete().eq('id', id);
  if (!error) {
    showToast('Note deleted');
    fetchWorkspaceData();
  } else {
    showToast('Couldn’t delete the note. Try again.');
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
$('saveProjectBtn')?.addEventListener('click', async () => {
  if (!supabaseClient || !currentUser) {
    showToast('You’re signed out. Sign in again to save.');
    return;
  }

  const name = $('projectName').value.trim();
  const description = $('projectDescription').value.trim();

  if (!name) {
    showToast('Give the project a name');
    $('projectName').focus();
    return;
  }

  const { error } = await supabaseClient.from('projects').insert({
    user_id: currentUser.id,
    name,
    description
  });

  if (error) {
    showToast('Couldn’t create the project: ' + error.message);
    return;
  }

  showToast('Project created');
  hideModal('projectModal');
  $('projectName').value = '';
  $('projectDescription').value = '';
  fetchWorkspaceData();
});

// ---------------------------------------------------------------------------
// Voice recording
// ---------------------------------------------------------------------------
function pickRecorderMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function extensionFor(mime, fileName = '') {
  const type = (mime || '').split(';')[0].toLowerCase();
  const map = {
    'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/flac': 'flac'
  };
  if (map[type]) return map[type];
  const fromName = fileName.split('.').pop();
  return fromName && fromName !== fileName ? fromName.toLowerCase() : 'webm';
}

function formatClock(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function showRecordingPreview(blob) {
  const player = $('audioPlayer');
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(blob);
  $('audioPreview').classList.remove('hidden');
}

function releaseCapture() {
  if (mediaRecorder) {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = null;
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    mediaRecorder = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }
  try { speechRecognition?.stop(); } catch (_) { /* not running */ }
  clearInterval(recordTimer);
  recordTimer = null;
}

// Puts the whole voice modal back to its starting state
function resetVoiceModal() {
  releaseCapture();
  const player = $('audioPlayer');
  if (player.src) URL.revokeObjectURL(player.src);
  player.removeAttribute('src');

  recordedBlob = null;
  recordedDuration = 0;
  recordSeconds = 0;
  audioChunks = [];
  liveTranscript = '';

  recordOrb?.classList.remove('recording');
  if (recordTime) recordTime.textContent = '00:00';
  if (recordState) recordState.textContent = 'Ready when you are';
  startRecordBtn.disabled = false;
  startRecordBtn.innerHTML = START_LABEL;
  stopRecordBtn.disabled = true;

  $('audioPreview').classList.add('hidden');
  $('voiceTitle').value = '';
  $('transcriptText').value = '';
  $('audioUpload').value = '';
  saveAudioBtn.disabled = false;
  saveAudioBtn.textContent = 'Save voice note';
}

const isRecording = () => !!mediaRecorder && mediaRecorder.state === 'recording';

startRecordBtn?.addEventListener('click', async () => {
  // A new take replaces whatever was there before
  $('audioPreview').classList.add('hidden');
  recordedBlob = null;
  $('transcriptText').value = '';
  liveTranscript = '';
  audioChunks = [];

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (recordState) recordState.textContent = 'Microphone blocked. Allow access in your browser, then try again.';
    showToast('Microphone access is blocked');
    return;
  }

  const mime = pickRecorderMime();
  mediaRecorder = mime ? new MediaRecorder(audioStream, { mimeType: mime }) : new MediaRecorder(audioStream);
  const recorder = mediaRecorder;

  recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
  recorder.onstop = () => {
    recordedBlob = new Blob(audioChunks, { type: recorder.mimeType || mime || 'audio/webm' });
    recordedDuration = recordSeconds;
    showRecordingPreview(recordedBlob);
    if (recordState) recordState.textContent = 'Recording ready. Review it below.';
  };

  recorder.start(250);
  try { speechRecognition?.start(); } catch (_) { /* already running */ }

  recordOrb?.classList.add('recording');
  startRecordBtn.disabled = true;
  stopRecordBtn.disabled = false;
  if (recordState) recordState.textContent = 'Recording…';

  recordSeconds = 0;
  recordTime.textContent = '00:00';
  recordTimer = setInterval(() => {
    recordSeconds++;
    recordTime.textContent = formatClock(recordSeconds);
  }, 1000);
});

stopRecordBtn?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); // onstop builds the preview
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }
  try { speechRecognition?.stop(); } catch (_) { /* not running */ }
  clearInterval(recordTimer);
  recordTimer = null;

  recordOrb?.classList.remove('recording');
  startRecordBtn.disabled = false;
  startRecordBtn.innerHTML = '<span>●</span> Record again';
  stopRecordBtn.disabled = true;
});

// Upload an existing audio file instead of recording
$('audioUpload')?.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('audio/')) {
    showToast('Choose an audio file');
    e.target.value = '';
    return;
  }

  releaseCapture();
  recordOrb?.classList.remove('recording');
  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = true;

  recordedBlob = file;
  recordedDuration = 0;
  showRecordingPreview(file);
  $('voiceTitle').value = file.name.replace(/\.[^.]+$/, '');
  $('transcriptText').value = '';
  if (recordState) recordState.textContent = 'File ready. Review it below.';
  if (recordTime) recordTime.textContent = '00:00';

  // Read the real length from the file
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = URL.createObjectURL(file);
  probe.onloadedmetadata = () => {
    if (Number.isFinite(probe.duration)) {
      recordedDuration = Math.round(probe.duration);
      recordTime.textContent = formatClock(recordedDuration);
    }
    URL.revokeObjectURL(probe.src);
  };
  showToast('Uploaded files aren’t transcribed. You can type a transcript below.');
});

$('discardAudioBtn')?.addEventListener('click', () => {
  resetVoiceModal();
  showToast('Recording discarded');
});

saveAudioBtn?.addEventListener('click', async () => {
  if (!supabaseClient || !currentUser) {
    showToast('You’re signed out. Sign in again to save.');
    return;
  }
  if (!recordedBlob) {
    showToast('Record or upload audio first');
    return;
  }

  const title = $('voiceTitle').value.trim() || 'Voice recording';
  const transcript = $('transcriptText').value;
  const mime = (recordedBlob.type || 'audio/webm').split(';')[0];
  const ext = extensionFor(recordedBlob.type, recordedBlob.name);
  const storagePath = `${currentUser.id}/${Date.now()}.${ext}`;

  saveAudioBtn.disabled = true;
  saveAudioBtn.textContent = 'Saving…';

  try {
    const { error: uploadErr } = await supabaseClient.storage
      .from('notes_audio')
      .upload(storagePath, recordedBlob, { contentType: mime });
    if (uploadErr) throw new Error('upload failed: ' + uploadErr.message);

    const { error: insertErr } = await supabaseClient.from('notes').insert({
      user_id: currentUser.id,
      title,
      type: 'voice',
      storage_path: storagePath,
      mime_type: mime,
      duration_seconds: recordedDuration,
      transcript,
      project_id: activeProjectId
    });
    if (insertErr) {
      await supabaseClient.storage.from('notes_audio').remove([storagePath]); // don't leave an orphaned file
      throw new Error(insertErr.message);
    }
  } catch (err) {
    showToast('Couldn’t save the voice note: ' + err.message);
    saveAudioBtn.disabled = false;
    saveAudioBtn.textContent = 'Save voice note';
    return;
  }

  showToast('Voice note saved');
  hideModal('voiceModal');
  fetchWorkspaceData();
});

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function showModal(id) {
  const modal = $(id);
  if (!modal) return;
  setSidebar(false);
  modal.classList.remove('hidden');
  modal.querySelector('input:not([type="hidden"]):not([type="file"]), textarea')?.focus();
}

function hideModal(id) {
  $(id)?.classList.add('hidden');
  if (id === 'voiceModal') resetVoiceModal();
}

// Asks before throwing away a recording that hasn't been saved
function requestClose(id) {
  if (id === 'voiceModal' && (isRecording() || recordedBlob)) {
    if (!confirm('Discard this recording?')) return;
  }
  hideModal(id);
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => requestClose(btn.dataset.close));
});

// Clicking outside only closes the lightweight project dialog; the editor and recorder hold work
$('projectModal')?.addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) hideModal('projectModal');
});

$('newTextBtn')?.addEventListener('click', openNewTextNote);
$('newVoiceBtn')?.addEventListener('click', () => showModal('voiceModal'));
$('newProjectBtn')?.addEventListener('click', () => showModal('projectModal'));
$('sideAddProject')?.addEventListener('click', () => showModal('projectModal'));

// Enter submits the project form from the name field
$('projectName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('saveProjectBtn').click();
});

// ---------------------------------------------------------------------------
// Search + keyboard shortcuts
// ---------------------------------------------------------------------------
const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if ($('searchHint')) $('searchHint').textContent = isApple ? '⌘ K' : 'Ctrl K';

searchInput?.addEventListener('input', (e) => { searchQuery = e.target.value.trim(); renderNotes(); });

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    setSidebar(false);
    searchInput?.focus();
    searchInput?.select();
    return;
  }

  if (e.key !== 'Escape') return;

  const openModal = [...document.querySelectorAll('.modal-backdrop')].reverse().find((m) => !m.classList.contains('hidden'));
  if (openModal) return requestClose(openModal.id);
  if (sidebar?.classList.contains('open')) return setSidebar(false);
  if (document.activeElement === searchInput && searchInput.value) {
    searchInput.value = '';
    searchQuery = '';
    renderNotes();
  }
});

// ---------------------------------------------------------------------------
// Init: pick up a session that finished loading before this script ran
// ---------------------------------------------------------------------------
if (window.AudiNotesAuth?.getUser()) {
  currentUser = window.AudiNotesAuth.getUser();
  supabaseClient = window.AudiNotesAuth.getClient();
  fetchWorkspaceData();
}
