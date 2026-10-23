// ---------------------------------------------------------------------------
// AudiNotes — app logic
// ---------------------------------------------------------------------------

// Application state
let supabaseClient = null;
let currentUser = null;
let notes = [];
let projects = [];
let activeFilter = 'all';      // 'projects' | 'all' | 'text' | 'voice'
let activeProjectId = null;    // set while looking inside one project
let searchQuery = '';
let playingId = null;
let draggedNoteId = null;

// Recording state
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;
let recordedBlob = null;
let recordedDuration = 0;

// DOM references
const $ = (id) => document.getElementById(id);
const sidebar = $('sidebar');
const sidebarScrim = $('sidebarScrim');
const mobileMenu = $('mobileMenu');
const notesGrid = $('notesGrid');
const notesCount = $('notesCount');
const notesHeading = $('notesHeading');
const allCount = $('allCount');
const projectCount = $('projectCount');
const searchInput = $('searchInput');
const pageTitle = $('pageTitle');
const dropTray = $('dropTray');

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

const FILTER_LABELS = { projects: 'Projects', all: 'All notes', text: 'Text notes', voice: 'Voice notes' };
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
const isProjectsView = () => activeFilter === 'projects' && !activeProjectId;

function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatClock(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
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
    activeFilter = 'all';
    activeProjectId = null;
    render();
  }
});

async function fetchWorkspaceData() {
  if (!supabaseClient || !currentUser) return;

  const { data: fetchProjects, error: pErr } = await supabaseClient
    .from('projects')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });

  if (!pErr && fetchProjects) {
    projects = fetchProjects;
    // The project we were looking at no longer exists
    if (activeProjectId && !findProject(activeProjectId)) {
      activeProjectId = null;
      activeFilter = 'projects';
    }
  }

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

  render();
}

// ---------------------------------------------------------------------------
// Views: Projects / All notes / Text notes / Voice notes / inside one project
// ---------------------------------------------------------------------------
function setView(filter, projectId = null) {
  activeFilter = filter;
  activeProjectId = projectId;
  render();
  setSidebar(false);
}

function updateChrome() {
  const project = activeProjectId ? findProject(activeProjectId) : null;
  const projectsView = isProjectsView();

  const title = project ? project.name : FILTER_LABELS[activeFilter];
  if (pageTitle?.childNodes[0]) pageTitle.childNodes[0].nodeValue = title;
  document.title = `${title} · AudiNotes`;

  const activeNav = activeProjectId ? 'projects' : activeFilter;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.filter === activeNav));

  // Keep back button visible only inside a project view
  $('backToProjectsBtn')?.classList.toggle('hidden', !activeProjectId);

  // Keep all creation buttons visible in topbar across all menus
  $('newTextBtn')?.classList.remove('hidden');
  $('newVoiceBtn')?.classList.remove('hidden');
  $('newProjectBtn')?.classList.remove('hidden');

  notesHeading.textContent = projectsView ? 'All projects' : activeProjectId ? 'Notes in this project' : 'Recent notes';
  searchInput.placeholder = projectsView ? 'Search projects...' : 'Search your notes...';
  searchInput.setAttribute('aria-label', projectsView ? 'Search projects' : 'Search notes');
}

function render() {
  if (allCount) allCount.textContent = notes.length;
  if (projectCount) projectCount.textContent = projects.length;
  updateChrome();
  if (isProjectsView()) renderProjectCards();
  else renderNotes();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.filter));
});

$('backToProjectsBtn')?.addEventListener('click', () => setView('projects'));

// ---------------------------------------------------------------------------
// Project cards
// ---------------------------------------------------------------------------
function renderProjectCards() {
  const q = searchQuery.toLowerCase();
  const filtered = projects.filter((p) =>
    !q || (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
  );

  notesCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'project' : 'projects'}`;

  if (filtered.length === 0) {
    notesGrid.innerHTML = searchQuery ? '<p class="no-results">No projects match your search.</p>' : '';
    return;
  }

  notesGrid.innerHTML = filtered.map((p) => {
    const count = notes.filter((n) => sameId(n.project_id, p.id)).length;
    return `
    <div class="note-card project-card" data-project-id="${escapeHtml(p.id)}" tabindex="0" aria-label="Open project: ${escapeHtml(p.name)}">
      <div class="note-card-top">
        <span class="type-pill project">project</span>
        <button class="round-btn delete-btn" data-action="delete-project" type="button" aria-label="Delete project" title="Delete project">✕</button>
      </div>
      <h3>${escapeHtml(p.name)}</h3>
      <p class="note-excerpt">${escapeHtml(p.description || 'No description')}</p>
      <div class="note-card-bottom">
        <span class="note-date">${count} ${count === 1 ? 'note' : 'notes'}</span>
      </div>
    </div>`;
  }).join('');
}

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

async function deleteProject(id) {
  const project = findProject(id);
  if (!project) return;

  const count = notes.filter((n) => sameId(n.project_id, id)).length;
  const keepNote = count
    ? ` Its ${count} ${count === 1 ? 'note' : 'notes'} will stay in All notes.`
    : '';
  if (!confirm(`Delete the project “${project.name}”?${keepNote}`)) return;

  // Free the notes first so they aren't lost or blocked by a foreign key
  const { error: freeErr } = await supabaseClient
    .from('notes')
    .update({ project_id: null })
    .eq('project_id', project.id)
    .eq('user_id', currentUser.id);
  if (freeErr) {
    showToast('Couldn’t delete the project: ' + freeErr.message);
    return;
  }

  const { error } = await supabaseClient.from('projects').delete().eq('id', project.id);
  if (error) {
    showToast('Couldn’t delete the project: ' + error.message);
    return;
  }

  showToast('Project deleted');
  fetchWorkspaceData();
}

// ---------------------------------------------------------------------------
// Note cards
// ---------------------------------------------------------------------------
function noteExcerpt(n) {
  if (n.body) return n.body;
  if (n.type === 'voice') return n.duration_seconds ? `Voice recording, ${formatClock(n.duration_seconds)}` : 'Voice recording';
  return 'Empty note';
}

function renderNotes() {
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
      (n.body && n.body.toLowerCase().includes(q))
    );
  }

  notesCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;

  if (filtered.length === 0) {
    notesGrid.innerHTML = searchQuery ? '<p class="no-results">No notes match your search.</p>' : '';
    return;
  }

  notesGrid.innerHTML = filtered.map((n) => `
    <div class="note-card" data-id="${escapeHtml(n.id)}" draggable="true" tabindex="0" aria-label="Open note: ${escapeHtml(n.title)}">
      <div class="note-card-top">
        <span class="type-pill ${escapeHtml(n.type)}">${escapeHtml(n.type)}</span>
        <button class="round-btn delete-btn" data-action="delete" type="button" aria-label="Delete note" title="Delete">✕</button>
      </div>
      <h3>${escapeHtml(n.title || 'Untitled note')}</h3>
      <p class="note-excerpt">${escapeHtml(noteExcerpt(n))}</p>
      <div class="note-card-bottom">
        <span class="note-date">${formatDate(n.updated_at || n.created_at)}</span>
        ${n.audio_url ? '<button class="round-btn play-btn" data-action="play" type="button" aria-label="Play recording" title="Play">▶</button>' : ''}
      </div>
    </div>
  `).join('');

  syncPlayState();
}

// One delegated listener for every card and every button on a card
notesGrid?.addEventListener('click', (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  const action = e.target.closest('[data-action]')?.dataset.action;

  if (card.dataset.projectId) {
    if (action === 'delete-project') return deleteProject(card.dataset.projectId);
    return setView('all', findProject(card.dataset.projectId)?.id ?? null);
  }

  const id = card.dataset.id;
  if (action === 'play') return togglePlayback(id);
  if (action === 'delete') return deleteNote(id);
  openEditModal(id);
});

notesGrid?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('note-card')) return;
  if (e.target.dataset.projectId) setView('all', findProject(e.target.dataset.projectId)?.id ?? null);
  else openEditModal(e.target.dataset.id);
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
// Drag a note to file it in a project (or take it out of one)
// ---------------------------------------------------------------------------
async function moveNoteToProject(noteId, projectId) {
  const note = findNote(noteId);
  if (!note || !supabaseClient) return;

  const target = projectId ? findProject(projectId) : null;
  const nextId = target ? target.id : null;

  if (sameId(note.project_id, nextId) || (note.project_id == null && nextId == null)) {
    showToast(target ? `Already in ${target.name}` : 'This note isn’t in a project');
    return;
  }

  const previous = note.project_id;
  note.project_id = nextId; // update the screen first, undo if saving fails
  render();

  const { error } = await supabaseClient.from('notes').update({ project_id: nextId }).eq('id', note.id);
  if (error) {
    note.project_id = previous;
    render();
    showToast('Couldn’t move the note: ' + error.message);
    return;
  }
  showToast(target ? `Moved to ${target.name}` : 'Removed from project');
}

function showDropTray(note) {
  const chips = projects
    .filter((p) => !sameId(p.id, note.project_id))
    .map((p) => `<button class="drop-chip" data-project-id="${escapeHtml(p.id)}" type="button" tabindex="-1">Move to ${escapeHtml(p.name)}</button>`);
  if (note.project_id != null) {
    chips.push('<button class="drop-chip" data-project-id="" type="button" tabindex="-1">Remove from project</button>');
  }
  if (!chips.length) return;
  dropTray.innerHTML = chips.join('');
  dropTray.classList.add('visible');
}

function hideDropTray() {
  dropTray.classList.remove('visible');
  dropTray.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
}

notesGrid?.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('.note-card');
  if (!card || !card.dataset.id) return;
  draggedNoteId = card.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedNoteId);
  // Change the page after the browser has captured the drag image
  setTimeout(() => {
    card.classList.add('dragging');
    const note = findNote(draggedNoteId);
    if (note) showDropTray(note);
  }, 0);
});

notesGrid?.addEventListener('dragend', () => {
  draggedNoteId = null;
  document.querySelectorAll('.note-card.dragging').forEach((el) => el.classList.remove('dragging'));
  hideDropTray();
});

dropTray?.addEventListener('dragover', (e) => {
  const chip = e.target.closest('.drop-chip');
  if (!chip || !draggedNoteId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dropTray.querySelectorAll('.drop-target').forEach((el) => el !== chip && el.classList.remove('drop-target'));
  chip.classList.add('drop-target');
});

dropTray?.addEventListener('dragleave', (e) => {
  e.target.closest?.('.drop-chip')?.classList.remove('drop-target');
});

dropTray?.addEventListener('drop', (e) => {
  const chip = e.target.closest('.drop-chip');
  if (!chip || !draggedNoteId) return;
  e.preventDefault();
  const noteId = draggedNoteId;
  hideDropTray();
  moveNoteToProject(noteId, chip.dataset.projectId || null);
});

// ---------------------------------------------------------------------------
// Bottom player (always visible)
// ---------------------------------------------------------------------------
function syncPlayState() {
  document.querySelectorAll('.note-card[data-id]').forEach((card) => {
    const isCurrent = sameId(card.dataset.id, playingId);
    const isPlaying = isCurrent && !globalAudioPlayer.paused;
    card.classList.toggle('playing', isCurrent);
    const btn = card.querySelector('.play-btn');
    if (btn) {
      btn.textContent = isPlaying ? '❚❚' : '▶';
      btn.classList.toggle('is-playing', isPlaying);
      btn.setAttribute('aria-label', isPlaying ? 'Pause recording' : 'Play recording');
      btn.title = isPlaying ? 'Pause' : 'Play';
    }
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
  persistentPlayer.classList.remove('idle');
  globalAudioPlayer.play().catch(() => {});
  syncPlayState();
}

// Puts the player back to its idle state
function closePlayer() {
  globalAudioPlayer.pause();
  globalAudioPlayer.removeAttribute('src');
  globalAudioPlayer.load();
  playingId = null;
  playerTitle.textContent = 'Nothing playing';
  playerSub.textContent = 'Press play on a voice note';
  persistentPlayer.classList.add('idle');
  syncPlayState();
}

['play', 'pause', 'ended'].forEach((evt) => globalAudioPlayer.addEventListener(evt, syncPlayState));
globalAudioPlayer.addEventListener('error', () => {
  if (globalAudioPlayer.getAttribute('src')) showToast('Couldn’t play this recording. Check your connection and try again.');
});

// ---------------------------------------------------------------------------
// Note editor
// ---------------------------------------------------------------------------
function fillProjectSelect(selectedId) {
  const select = $('noteProject');
  select.innerHTML = '<option value="">No project</option>' + projects
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
    .join('');
  const selected = selectedId != null ? findProject(selectedId) : null;
  select.value = selected ? String(selected.id) : '';
}

function openNewTextNote() {
  $('noteId').value = '';
  $('noteTitle').value = '';
  $('noteBody').value = '';
  $('modalTitle').textContent = 'New note';
  fillProjectSelect(activeProjectId);
  showModal('noteModal');
}

function openEditModal(id) {
  const note = findNote(id);
  if (!note) return;

  $('noteId').value = note.id;
  $('noteTitle').value = note.title || '';
  $('noteBody').value = note.body || '';
  $('modalTitle').textContent = 'Edit note';
  fillProjectSelect(note.project_id);
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
  const projectId = findProject($('noteProject').value)?.id ?? null;

  btn.disabled = true;
  try {
    if (id) {
      const { error } = await supabaseClient.from('notes').update({
        title,
        body,
        project_id: projectId,
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
        project_id: projectId
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

  recordOrb?.classList.remove('recording');
  recordTime.textContent = '00:00';
  recordState.textContent = 'Ready when you are';
  startRecordBtn.disabled = false;
  startRecordBtn.innerHTML = START_LABEL;
  stopRecordBtn.disabled = true;

  $('audioPreview').classList.add('hidden');
  $('voiceTitle').value = '';
  $('audioUpload').value = '';
  saveAudioBtn.disabled = false;
  saveAudioBtn.textContent = 'Save voice note';
}

const isRecording = () => !!mediaRecorder && mediaRecorder.state === 'recording';

startRecordBtn?.addEventListener('click', async () => {
  // A new take replaces whatever was there before
  $('audioPreview').classList.add('hidden');
  recordedBlob = null;
  audioChunks = [];

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    recordState.textContent = 'Microphone blocked. Allow access in your browser, then try again.';
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
    recordState.textContent = 'Recording ready. Review it below.';
  };

  recorder.start(250);

  recordOrb?.classList.add('recording');
  startRecordBtn.disabled = true;
  stopRecordBtn.disabled = false;
  recordState.textContent = 'Recording…';

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
  recordState.textContent = 'File ready. Review it below.';
  recordTime.textContent = '00:00';

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

// Enter submits the project form from the name field
$('projectName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('saveProjectBtn').click();
});

// ---------------------------------------------------------------------------
// Search + keyboard shortcuts
// ---------------------------------------------------------------------------
const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if ($('searchHint')) $('searchHint').textContent = isApple ? '⌘ K' : 'Ctrl K';

searchInput?.addEventListener('input', (e) => { searchQuery = e.target.value.trim(); render(); });

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
    render();
  }
});

// ---------------------------------------------------------------------------
// Init: pick up a session that finished loading before this script ran
// ---------------------------------------------------------------------------
render();
if (window.AudiNotesAuth?.getUser()) {
  currentUser = window.AudiNotesAuth.getUser();
  supabaseClient = window.AudiNotesAuth.getClient();
  fetchWorkspaceData();
}
