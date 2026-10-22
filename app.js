// Application State & References
let supabaseClient = null;
let currentUser = null;
let notes = [];
let projects = [];
let activeFilter = 'all';
let activeProjectId = null;
let searchQuery = '';
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;
let recordedBlob = null;
let speechRecognition = null;
let liveTranscript = '';

// DOM Elements
const notesGrid = document.getElementById('notesGrid');
const notesCount = document.getElementById('notesCount');
const allCount = document.getElementById('allCount');
const projectList = document.getElementById('projectList');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const currentCrumb = document.getElementById('currentCrumb');
const pageTitle = document.getElementById('pageTitle');

// Persistent Player Elements
const persistentPlayer = document.getElementById('persistentPlayer');
const playerTitle = document.getElementById('playerTitle');
const playerSub = document.getElementById('playerSub');
const globalAudioPlayer = document.getElementById('globalAudioPlayer');
const playerPlayPauseBtn = document.getElementById('playerPlayPauseBtn');
const playerCloseBtn = document.getElementById('playerCloseBtn');

// Initialize Web Speech API Transcription
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
    const transcriptTextarea = document.getElementById('transcriptText');
    if (transcriptTextarea) {
      transcriptTextarea.value = (liveTranscript + interim).trim();
    }
  };
}

// Listen for Auth Changes
window.addEventListener('audionotes-auth-changed', (event) => {
  currentUser = event.detail.user;
  supabaseClient = event.detail.client;

  if (currentUser && supabaseClient) {
    fetchWorkspaceData();
  } else {
    notes = [];
    projects = [];
    renderProjects();
    renderNotes();
  }
});

// Fetch Notes & Projects from Supabase
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
    notes = fetchNotes.map(n => {
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

// Render Projects Sidebar
function renderProjects() {
  if (!projectList) return;
  projectList.innerHTML = projects.map(p => `
    <button class="project-item ${activeProjectId === p.id ? 'active' : ''}" onclick="selectProject('${p.id}')" type="button">
      <span class="project-color"></span>
      <span class="project-name">${escapeHtml(p.name)}</span>
    </button>
  `).join('');
}

window.selectProject = function(id) {
  activeProjectId = id;
  const project = projects.find(p => p.id === id);
  if (project) {
    if (currentCrumb) currentCrumb.textContent = project.name;
    if (pageTitle && pageTitle.childNodes[0]) pageTitle.childNodes[0].nodeValue = project.name;
  }
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  renderProjects();
  renderNotes();
};

// Breadcrumb Reset Action
document.getElementById('crumbWorkspace')?.addEventListener('click', () => {
  activeFilter = 'all';
  activeProjectId = null;
  if (currentCrumb) currentCrumb.textContent = 'All notes';
  if (pageTitle && pageTitle.childNodes[0]) pageTitle.childNodes[0].nodeValue = 'All notes';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('.nav-item[data-filter="all"]')?.classList.add('active');
  renderProjects();
  renderNotes();
});

// Sidebar Filter Navigation
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    activeProjectId = null;
    if (currentCrumb) currentCrumb.textContent = btn.innerText.replace(/[0-9]/g, '').trim();
    if (pageTitle && pageTitle.childNodes[0]) pageTitle.childNodes[0].nodeValue = currentCrumb.textContent;
    renderProjects();
    renderNotes();
  });
});

// Render Notes Grid
function renderNotes() {
  if (!notesGrid) return;

  let filtered = notes.filter(n => {
    if (activeProjectId) return n.project_id === activeProjectId;
    if (activeFilter === 'text') return n.type === 'text';
    if (activeFilter === 'voice') return n.type === 'voice';
    return true;
  });

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(n =>
      n.title.toLowerCase().includes(q) ||
      (n.body && n.body.toLowerCase().includes(q)) ||
      (n.transcript && n.transcript.toLowerCase().includes(q))
    );
  }

  if (allCount) allCount.textContent = notes.length;
  if (notesCount) notesCount.textContent = `${filtered.length} items`;

  if (filtered.length === 0) {
    notesGrid.innerHTML = '<p style="grid-column:1/-1; color:#898b98; text-align:center; padding:30px 0;">No notes found.</p>';
    return;
  }

  notesGrid.innerHTML = filtered.map(n => `
    <div class="note-card">
      <div class="note-card-top">
        <span class="type-pill ${n.type}">${n.type}</span>
      </div>
      <h3>${escapeHtml(n.title)}</h3>
      <p class="note-excerpt">${escapeHtml(n.body || n.transcript || 'No content provided.')}</p>
      
      <div class="note-card-bottom">
        <span class="note-date">${new Date(n.updated_at || n.created_at).toLocaleDateString()}</span>
        <div class="note-actions">
          ${n.audio_url ? `<button class="action-btn play-btn" onclick="playAudioTrack('${escapeHtml(n.title)}', '${n.audio_url}')" type="button">▶ Play</button>` : ''}
          <button class="action-btn edit-btn" onclick="openEditModal('${n.id}')" type="button">✎ Edit</button>
          <button class="action-btn delete-btn" onclick="deleteNote('${n.id}')" type="button">✕ Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Persistent Bottom Audio Player Controls (Spotify Style)
window.playAudioTrack = function(title, audioUrl) {
  if (!persistentPlayer || !globalAudioPlayer) return;
  playerTitle.textContent = title;
  globalAudioPlayer.src = audioUrl;
  persistentPlayer.classList.remove('hidden');
  globalAudioPlayer.play();
  if (playerPlayPauseBtn) playerPlayPauseBtn.textContent = '⏸';
};

playerPlayPauseBtn?.addEventListener('click', () => {
  if (!globalAudioPlayer) return;
  if (globalAudioPlayer.paused) {
    globalAudioPlayer.play();
    playerPlayPauseBtn.textContent = '⏸';
  } else {
    globalAudioPlayer.pause();
    playerPlayPauseBtn.textContent = '▶';
  }
});

playerCloseBtn?.addEventListener('click', () => {
  if (globalAudioPlayer) globalAudioPlayer.pause();
  persistentPlayer?.classList.add('hidden');
});

// Edit Note Modal
window.openEditModal = function(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  document.getElementById('noteId').value = note.id;
  document.getElementById('noteTitle').value = note.title;
  document.getElementById('noteBody').value = note.body || '';

  const transcriptSec = document.getElementById('modalTranscriptSection');
  const transcriptInput = document.getElementById('modalTranscript');

  if (note.type === 'voice') {
    transcriptSec.classList.remove('hidden');
    transcriptInput.value = note.transcript || '';
  } else {
    transcriptSec.classList.add('hidden');
  }

  showModal('noteModal');
};

// Save Note Action
document.getElementById('saveNoteBtn')?.addEventListener('click', async () => {
  if (!supabaseClient || !currentUser) {
    showToast('User authentication error.');
    return;
  }

  const id = document.getElementById('noteId').value;
  const title = document.getElementById('noteTitle').value.trim() || 'Untitled Note';
  const body = document.getElementById('noteBody').value;
  const transcript = document.getElementById('modalTranscript')?.value || '';

  if (id) {
    const { error } = await supabaseClient.from('notes').update({
      title,
      body,
      transcript,
      updated_at: new Date().toISOString()
    }).eq('id', id);

    if (error) {
      showToast('Error updating note: ' + error.message);
      return;
    }
    showToast('Note updated successfully');
  } else {
    const { error } = await supabaseClient.from('notes').insert({
      user_id: currentUser.id,
      title,
      body,
      type: 'text',
      project_id: activeProjectId
    });

    if (error) {
      showToast('Error creating note: ' + error.message);
      return;
    }
    showToast('Note created successfully');
  }

  hideModal('noteModal');
  fetchWorkspaceData();
});

// Delete Note Action
window.deleteNote = async function(id) {
  if (!confirm('Are you sure you want to delete this note?')) return;
  const note = notes.find(n => n.id === id);
  
  if (note && note.storage_path) {
    await supabaseClient.storage.from('notes_audio').remove([note.storage_path]);
  }

  const { error } = await supabaseClient.from('notes').delete().eq('id', id);
  if (!error) {
    showToast('Note deleted');
    fetchWorkspaceData();
  } else {
    showToast('Failed to delete note');
  }
};

// Save Project Action
document.getElementById('saveProjectBtn')?.addEventListener('click', async () => {
  if (!supabaseClient || !currentUser) {
    showToast('User authentication error.');
    return;
  }

  const name = document.getElementById('projectName').value.trim();
  const description = document.getElementById('projectDescription').value.trim() || '';

  if (!name) {
    showToast('Project name is required');
    return;
  }

  const { error } = await supabaseClient.from('projects').insert({
    user_id: currentUser.id,
    name,
    description
  });

  if (error) {
    showToast('Error creating project: ' + error.message);
    return;
  }

  showToast('Project created successfully');
  hideModal('projectModal');
  document.getElementById('projectName').value = '';
  document.getElementById('projectDescription').value = '';
  fetchWorkspaceData();
});

// Audio Recording Controls (Lag-Free & Full Stream Release Fix)
const startRecordBtn = document.getElementById('startRecordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const recordOrb = document.getElementById('recordOrb');
const recordTime = document.getElementById('recordTime');

startRecordBtn?.addEventListener('click', async () => {
  liveTranscript = '';
  audioChunks = [];
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(recordedBlob);
      document.getElementById('audioPlayer').src = audioUrl;
      document.getElementById('audioPreview').classList.remove('hidden');
    };

    mediaRecorder.start(250);
    if (speechRecognition) speechRecognition.start();

    recordOrb?.classList.add('recording');
    startRecordBtn.disabled = true;
    stopRecordBtn.disabled = false;

    recordSeconds = 0;
    recordTimer = setInterval(() => {
      recordSeconds++;
      const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      const s = String(recordSeconds % 60).padStart(2, '0');
      if (recordTime) recordTime.textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    alert('Microphone access denied or unavailable.');
  }
});

stopRecordBtn?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Explicitly close audio stream tracks to release browser microphone indicator
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  if (speechRecognition) speechRecognition.stop();
  clearInterval(recordTimer);

  recordOrb?.classList.remove('recording');
  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = true;
});

// Discard Audio Recording Action
document.getElementById('discardAudioBtn')?.addEventListener('click', () => {
  recordedBlob = null;
  audioChunks = [];
  document.getElementById('audioPlayer').src = '';
  document.getElementById('audioPreview').classList.add('hidden');
  document.getElementById('voiceTitle').value = '';
  document.getElementById('transcriptText').value = '';
  showToast('Audio discarded');
});

// Save Voice Note Action
document.getElementById('saveAudioBtn')?.addEventListener('click', async () => {
  if (!supabaseClient || !currentUser) {
    showToast('User authentication error.');
    return;
  }

  if (!recordedBlob) {
    showToast('No audio recorded to save.');
    return;
  }

  const title = document.getElementById('voiceTitle').value.trim() || 'Voice Recording';
  const transcript = document.getElementById('transcriptText').value;
  const storagePath = `${currentUser.id}/${Date.now()}.webm`;

  const { error: uploadErr } = await supabaseClient.storage
    .from('notes_audio')
    .upload(storagePath, recordedBlob);

  if (uploadErr) {
    showToast('Failed to upload audio: ' + uploadErr.message);
    return;
  }

  const { error: insertErr } = await supabaseClient.from('notes').insert({
    user_id: currentUser.id,
    title,
    type: 'voice',
    storage_path: storagePath,
    mime_type: 'audio/webm',
    duration_seconds: recordSeconds,
    transcript,
    project_id: activeProjectId
  });

  if (insertErr) {
    showToast('Failed to save voice note: ' + insertErr.message);
    return;
  }

  showToast('Voice note saved online!');
  hideModal('voiceModal');
  
  recordedBlob = null;
  document.getElementById('audioPreview').classList.add('hidden');
  document.getElementById('voiceTitle').value = '';
  document.getElementById('transcriptText').value = '';

  fetchWorkspaceData();
});

// Modal Helper Utilities
function showModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id)?.classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => hideModal(btn.dataset.close));
});

document.getElementById('newTextBtn')?.addEventListener('click', () => {
  document.getElementById('noteId').value = '';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteBody').value = '';
  document.getElementById('modalTranscriptSection').classList.add('hidden');
  showModal('noteModal');
});

document.getElementById('newVoiceBtn')?.addEventListener('click', () => showModal('voiceModal'));
document.getElementById('newProjectBtn')?.addEventListener('click', () => showModal('projectModal'));
document.getElementById('sideAddProject')?.addEventListener('click', () => showModal('projectModal'));

searchInput?.addEventListener('input', (e) => { searchQuery = e.target.value; renderNotes(); });

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  return str ? str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '';
}

// Fallback init check if auth already loaded
if (window.AudiNotesAuth?.getUser()) {
  currentUser = window.AudiNotesAuth.getUser();
  supabaseClient = window.AudiNotesAuth.getClient();
  fetchWorkspaceData();
}