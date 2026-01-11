import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { QuillBinding } from 'y-quill';
import Quill from 'quill';
import QuillCursors from 'quill-cursors';

// Register Cursors Module
Quill.register('modules/cursors', QuillCursors);

// Register Fonts
const Font = Quill.import('attributors/style/font');
Font.whitelist = ['roboto', 'aref', 'inconsolata', 'merriweather', 'playfair', 'garamond', 'opensans', 'lato', 'montserrat', 'poppins', 'raleway', 'firacode', 'sourcecode', 'ubuntumono', 'dancing', 'pacifico'];
Quill.register(Font, true);

// ===== GLOBAL STATE =====
let editor;
let provider;
let sessionStartTime = Date.now();

// ===== USER COLORS =====
const COLORS = [
  { color: '#667eea', light: '#a5b4fc' },
  { color: '#f093fb', light: '#fbbf24' },
  { color: '#4ade80', light: '#86efac' },
  { color: '#fb7185', light: '#fda4af' },
  { color: '#38bdf8', light: '#7dd3fc' },
  { color: '#a78bfa', light: '#c4b5fd' },
  { color: '#fbbf24', light: '#fcd34d' },
  { color: '#34d399', light: '#6ee7b7' }
];

const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];

// ===== UTILITY FUNCTIONS =====
function generateSessionId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateAnonymousName() {
  const adjectives = ['Swift', 'Clever', 'Brave', 'Quick', 'Silent', 'Wise', 'Bold', 'Mighty', 'Calm', 'Bright'];
  const nouns = ['Snake', 'Viper', 'Python', 'Cobra', 'Serpent', 'Adder', 'Mamba', 'Boa', 'Anaconda', 'Rattler'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj} ${noun} ${num}`;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

function getSessionUrl(sessionId) {
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}#${sessionId}`;
}

function updateStats() {
  const text = editor.getText();
  const charCount = text.length - 1; // Subtract trailing newline
  const lineCount = text.split('\n').length - 1;
  
  document.getElementById('char-count').textContent = `${charCount.toLocaleString()} character${charCount !== 1 ? 's' : ''}`;
  document.getElementById('line-count').textContent = `${lineCount.toLocaleString()} line${lineCount !== 1 ? 's' : ''}`;
}

function updateSessionTime() {
  const elapsed = Date.now() - sessionStartTime;
  const minutes = Math.floor(elapsed / 60000);
  const hours = Math.floor(minutes / 60);
  
  let timeText;
  if (hours > 0) {
    timeText = `${hours}h ${minutes % 60}m ago`;
  } else if (minutes > 0) {
    timeText = `${minutes}m ago`;
  } else {
    timeText = 'Just now';
  }
  
  document.getElementById('session-time').textContent = timeText;
}

// ===== BOOTSTRAP ALERTS =====
function showAlert(message, type = 'info', duration = 4000) {
  const alertContainer = document.getElementById('alert-container');
  const alertId = 'alert-' + Date.now();
  
  const alertTypes = {
    'success': 'alert-success',
    'error': 'alert-danger',
    'warning': 'alert-warning',
    'info': 'alert-info'
  };
  
  const icons = {
    'success': 'bi-check-circle-fill',
    'error': 'bi-exclamation-triangle-fill',
    'warning': 'bi-exclamation-circle-fill',
    'info': 'bi-info-circle-fill'
  };
  
  const alertClass = alertTypes[type] || 'alert-info';
  const iconClass = icons[type] || 'bi-info-circle-fill';
  
  const alertEl = document.createElement('div');
  alertEl.id = alertId;
  alertEl.className = `alert ${alertClass} alert-dismissible fade show d-flex align-items-center`;
  alertEl.setAttribute('role', 'alert');
  alertEl.innerHTML = `
    <i class="bi ${iconClass} me-2"></i>
    <div>${message}</div>
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  
  alertContainer.appendChild(alertEl);
  
  // Auto-dismiss after duration
  if (duration > 0) {
    setTimeout(() => {
      const alert = document.getElementById(alertId);
      if (alert) {
        const bsAlert = bootstrap.Alert.getInstance(alert);
        if (bsAlert) {
          bsAlert.close();
        } else {
          alert.remove();
        }
      }
    }, duration);
  }
}


// ===== YJS SETUP =====
let ydoc;
let ytext;
let ypages; // Yjs Map for pages
let currentPageId = 'page-1'; // Default page

function initializeEditor() {
  ydoc = new Y.Doc();
  
  // Initialize pages map
  ypages = ydoc.getMap('pages');
  
  // Get or create session ID from URL hash
  let sessionId = window.location.hash.substring(1);
  if (!sessionId) {
    sessionId = generateSessionId();
    window.location.hash = sessionId;
  }
  
  // Display session ID
  document.getElementById('session-id').textContent = sessionId;
  
  // Setup persistence
  const persistence = new IndexeddbPersistence(sessionId, ydoc);
  persistence.on('synced', () => {
    console.log('Local storage synced');
    
    // Initialize default page if no pages exist
    if (ypages.size === 0) {
      ypages.set('page-1', JSON.stringify({
        id: 'page-1',
        name: 'Untitled Document',
        content: '',
        createdAt: Date.now()
      }));
    }
    
    // Load the first page or current page
    loadPage(currentPageId);
    updatePagesList();
  });
  
  // Setup WebRTC provider
  provider = new WebrtcProvider(sessionId, ydoc, {
    signaling: ['wss://signaling-server-2s0k.onrender.com']
  });
  
  provider.on('status', event => {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    
    if (event.connected) {
      dot.classList.remove('bg-warning');
      dot.classList.add('bg-success');
      text.textContent = 'Connected';
    } else {
      dot.classList.remove('bg-success');
      dot.classList.add('bg-warning');
      text.textContent = 'Connecting...';
    }
  });
  
  // Initialize Quill editor
  editor = new Quill('#editor-container', {
    theme: 'snow',
    modules: {
      cursors: true,
      toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'header': 1 }, { 'header': 2 }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        ['link'],
        ['clean'],
        [{ 'font': ['roboto', 'aref', 'inconsolata', 'merriweather', 'playfair', 'garamond', 'opensans', 'lato', 'montserrat', 'poppins', 'raleway', 'firacode', 'sourcecode', 'ubuntumono', 'dancing', 'pacifico'] }, { 'size': [] }]
      ]
    },
    placeholder: 'Start typing or paste your code here...'
  });
  
  // Track text changes for stats and auto-save
  const debouncedSave = debounce(saveCurrentPage, 1000);
  
  editor.on('text-change', () => {
    updateStats();
    debouncedSave();
  });
  
  // Update awareness with user info
  provider.awareness.on('change', () => {
    updateUsersList();
    updateUserCount();
  });
  
  // Listen for pages changes
  ypages.observe(() => {
    updatePagesList();
  });
  
  // Initial stats update
  updateStats();
  
  // Update session time every minute
  setInterval(updateSessionTime, 60000);
  updateSessionTime();
}

// ===== PAGES MANAGEMENT =====
let currentBinding = null; // Track the current Yjs binding

function loadPage(pageId) {
  // Save current page before switching
  if (currentPageId && editor) {
    saveCurrentPage();
  }
  
  currentPageId = pageId;
  
  const pageData = ypages.get(pageId);
  if (pageData) {
    const page = JSON.parse(pageData);
    
    // Update document title
    document.getElementById('document-title').value = page.name;
    
    // Setup Yjs text for this page
    const pageTextKey = `page-text-${pageId}`;
    ytext = ydoc.getText(pageTextKey);
    
    // Destroy previous binding if it exists
    if (currentBinding) {
      currentBinding.destroy();
    }
    
    // Create new binding for this page
    currentBinding = new QuillBinding(ytext, editor, provider.awareness);
    
    // If the Yjs text is empty but page has content, initialize it
    if (ytext.length === 0 && page.content) {
      editor.setText(page.content);
    }
  }
  
  updatePagesList();
}

function saveCurrentPage() {
  if (!currentPageId || !editor) return;
  
  const pageData = ypages.get(currentPageId);
  if (pageData) {
    const page = JSON.parse(pageData);
    page.content = editor.getText();
    page.name = document.getElementById('document-title').value || 'Untitled Document';
    ypages.set(currentPageId, JSON.stringify(page));
  }
}

function createNewPage() {
  const pageId = 'page-' + Date.now();
  const newPage = {
    id: pageId,
    name: 'New Page',
    content: '',
    createdAt: Date.now()
  };
  
  ypages.set(pageId, JSON.stringify(newPage));
  loadPage(pageId);
}

function updatePagesList() {
  const container = document.getElementById('pages-container');
  container.innerHTML = '';
  
  const pages = [];
  ypages.forEach((pageData, pageId) => {
    const page = JSON.parse(pageData);
    pages.push(page);
  });
  
  // Sort by creation date
  pages.sort((a, b) => a.createdAt - b.createdAt);
  
  pages.forEach(page => {
    const pageEl = document.createElement('div');
    pageEl.className = `page-item ${page.id === currentPageId ? 'active' : ''}`;
    
    // Icon
    const icon = document.createElement('i');
    icon.className = 'bi bi-file-earmark-text';
    pageEl.appendChild(icon);
    
    // Page Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'page-name';
    nameSpan.textContent = page.name;
    pageEl.appendChild(nameSpan);
    
    // Actions Container
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'page-actions';
    
    // Rename Button
    const renameBtn = document.createElement('button');
    renameBtn.className = 'page-action-btn';
    renameBtn.title = 'Rename';
    renameBtn.innerHTML = '<i class="bi bi-pencil"></i>';
    renameBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent page switching
      openRenamePageModal(page.id);
    };
    
    // Clear Button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'page-action-btn';
    clearBtn.title = 'Clear Content';
    clearBtn.innerHTML = '<i class="bi bi-eraser"></i>';
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      confirmClearPage(page.id, page.name);
    };

    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'page-action-btn';
    deleteBtn.title = 'Delete Page';
    deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      confirmDeletePage(page.id, page.name);
    };
    
    actionsDiv.appendChild(renameBtn);
    actionsDiv.appendChild(clearBtn);
    actionsDiv.appendChild(deleteBtn);
    pageEl.appendChild(actionsDiv);
    
    // Click to switch page
    pageEl.onclick = (e) => {
      // Only switch if we didn't click inside page-actions (doubly safe)
      if (!e.target.closest('.page-actions')) {
        loadPage(page.id);
      }
    };
    
    container.appendChild(pageEl);
  });
}

// ===== GENERIC CONFIRMATION MODAL =====
const confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));
let onConfirmAction = null;

function showConfirmation(title, message, btnClass, btnText, onConfirm) {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-body').textContent = message;
  const btn = document.getElementById('btn-confirm-action');
  btn.className = `btn btn-sm ${btnClass}`;
  btn.textContent = btnText;
  
  onConfirmAction = onConfirm;
  confirmationModal.show();
}

document.getElementById('btn-confirm-action').onclick = () => {
  if (onConfirmAction) onConfirmAction();
  confirmationModal.hide();
};

function confirmClearPage(pageId, pageName) {
  showConfirmation(
    'Clear Page Content?', 
    `Are you sure you want to clear all content from "${pageName}"?`,
    'btn-warning',
    'Clear Content',
    () => {
      const pageData = ypages.get(pageId);
      if (pageData) {
        const page = JSON.parse(pageData);
        page.content = '';
        ypages.set(pageId, JSON.stringify(page));
        
        if (pageId === currentPageId) {
          editor.setText('');
        }
        showAlert('Page content cleared', 'info');
      }
    }
  );
}

function confirmDeletePage(pageId, pageName) {
  if (ypages.size <= 1) {
    showAlert('Cannot delete the last page!', 'error');
    return;
  }

  showConfirmation(
    'Delete Page?', 
    `Are you sure you want to delete "${pageName}"? This cannot be undone.`,
    'btn-danger',
    'Delete',
    () => {
      ypages.delete(pageId);
      
      if (pageId === currentPageId) {
        const firstPageId = Array.from(ypages.keys())[0];
        loadPage(firstPageId);
      }
      
      showAlert(`"${pageName}" deleted`, 'success');
    }
  );
}

// ===== PAGE RENAME/DELETE MODAL =====
const renamePageModal = new bootstrap.Modal(document.getElementById('renamePageModal'));
const renamePageInput = document.getElementById('rename-page-input');
let currentRenamingPageId = null;

window.openRenamePageModal = function(pageId) {
  currentRenamingPageId = pageId;
  const pageData = ypages.get(pageId);
  if (pageData) {
    const page = JSON.parse(pageData);
    renamePageInput.value = page.name;
    renamePageModal.show();
    setTimeout(() => renamePageInput.focus(), 300);
  }
};

document.getElementById('btn-save-page-name').onclick = () => {
  const newName = renamePageInput.value.trim();
  if (!newName) {
    showAlert('Please enter a page name!', 'warning');
    return;
  }
  
  if (currentRenamingPageId) {
    const pageData = ypages.get(currentRenamingPageId);
    if (pageData) {
      const page = JSON.parse(pageData);
      page.name = newName;
      ypages.set(currentRenamingPageId, JSON.stringify(page));
      
      // Update document title if it's the current page
      if (currentRenamingPageId === currentPageId) {
        document.getElementById('document-title').value = newName;
      }
      
      showAlert(`Page renamed to "${newName}"`, 'success');
    }
  }
  
  renamePageModal.hide();
};

document.getElementById('btn-clear-page').onclick = () => {
  if (!currentRenamingPageId) return;
  
  if (confirm('Are you sure you want to clear all content from this page?')) {
    // Clear the page content
    const pageData = ypages.get(currentRenamingPageId);
    if (pageData) {
      const page = JSON.parse(pageData);
      page.content = '';
      ypages.set(currentRenamingPageId, JSON.stringify(page));
      
      // If it's the current page, clear the editor
      if (currentRenamingPageId === currentPageId) {
        editor.setText('');
      }
      
      showAlert('Page content cleared', 'info');
    }
    
    renamePageModal.hide();
  }
};

document.getElementById('btn-delete-page').onclick = () => {
  if (!currentRenamingPageId) return;
  
  // Don't allow deleting the last page
  if (ypages.size <= 1) {
    showAlert('Cannot delete the last page!', 'error');
    return;
  }
  
  if (confirm('Are you sure you want to delete this page?')) {
    const pageData = ypages.get(currentRenamingPageId);
    const pageName = pageData ? JSON.parse(pageData).name : 'Page';
    
    ypages.delete(currentRenamingPageId);
    
    // If we deleted the current page, switch to another page
    if (currentRenamingPageId === currentPageId) {
      const firstPageId = Array.from(ypages.keys())[0];
      loadPage(firstPageId);
    }
    
    showAlert(`"${pageName}" deleted`, 'success');
    renamePageModal.hide();
  }
};

renamePageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-save-page-name').click();
  }
});

// New page button
document.getElementById('btn-new-page').onclick = createNewPage;


// ===== USER MANAGEMENT =====
function updateUsersList() {
  const container = document.getElementById('users-container');
  const states = provider.awareness.getStates();
  
  container.innerHTML = '';
  
  if (states.size === 0) {
    container.innerHTML = '<p class="text-muted text-center small mb-0">Waiting for collaborators...</p>';
    return;
  }
  
  states.forEach((state, clientId) => {
    if (state.user && state.user.name) {
      const isMe = clientId === provider.awareness.clientID;
      const userEl = document.createElement('div');
      userEl.className = 'user-item fade-in';
      userEl.style.borderLeftColor = state.user.color;
      
      // Make clickable if it's the current user
      if (isMe) {
        userEl.style.cursor = 'pointer';
        userEl.title = 'Click to edit your name';
        userEl.onclick = () => openEditNameModal();
      }
      
      const initials = state.user.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
      
      userEl.innerHTML = `
        <div class="user-avatar" style="background: ${state.user.color}">
          ${initials}
        </div>
        <div class="user-info">
          <div class="user-name">${state.user.name}${isMe ? ' (You)' : ''}</div>
          <div class="user-status">
            <i class="bi bi-circle-fill" style="font-size: 6px; color: ${state.user.color}"></i>
            Online
          </div>
        </div>
      `;
      
      container.appendChild(userEl);
    }
  });
}

function updateUserCount() {
  const count = provider.awareness.getStates().size;
  document.getElementById('user-count').textContent = count;
  document.getElementById('active-users-count').textContent = count;
}

// ===== AUTO-JOIN WITH ANONYMOUS NAME =====
let currentUsername = '';

window.addEventListener('load', () => {
  // Generate or retrieve username
  let storedName = localStorage.getItem('snakey_username');
  if (!storedName) {
    storedName = generateAnonymousName();
    localStorage.setItem('snakey_username', storedName);
  }
  currentUsername = storedName;
  
  // Initialize editor first
  initializeEditor();
  
  // Auto-join after a short delay to ensure provider is ready
  setTimeout(() => {
    provider.awareness.setLocalStateField('user', {
      name: currentUsername,
      color: myColor.color
    });
    
    // Show welcome toast
    const toastEl = document.getElementById('welcomeToast');
    const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
    document.getElementById('toast-username').textContent = currentUsername;
    toast.show();
  }, 500);
});

// ===== EDIT NAME MODAL =====
const editNameModal = new bootstrap.Modal(document.getElementById('editNameModal'));
const editNameInput = document.getElementById('edit-name-input');

function openEditNameModal() {
  editNameInput.value = currentUsername;
  editNameModal.show();
  setTimeout(() => editNameInput.focus(), 300);
}

document.getElementById('btn-save-name').onclick = () => {
  const newName = editNameInput.value.trim();
  if (!newName) {
    showAlert('Please enter a name!', 'warning');
    return;
  }
  
  currentUsername = newName;
  localStorage.setItem('snakey_username', newName);
  
  provider.awareness.setLocalStateField('user', {
    name: currentUsername,
    color: myColor.color
  });
  
  showAlert(`Name updated to "${newName}"`, 'success');
  editNameModal.hide();
};

editNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-save-name').click();
  }
});

// ===== BUTTON HANDLERS =====

// Share button
document.getElementById('btn-share').onclick = () => {
  const sessionId = window.location.hash.substring(1);
  const url = getSessionUrl(sessionId);
  
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-share');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Copied!';
    btn.classList.add('btn-success');
    btn.classList.remove('btn-primary');
    
    showAlert('Session link copied to clipboard!', 'success', 2000);
    
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.classList.remove('btn-success');
      btn.classList.add('btn-primary');
    }, 2000);
  });
};

// Copy link button
document.getElementById('btn-copy-link').onclick = () => {
  const sessionId = window.location.hash.substring(1);
  const url = getSessionUrl(sessionId);
  
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-copy-link');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Copied!';
    
    showAlert('Session link copied!', 'success', 2000);
    
    setTimeout(() => {
      btn.innerHTML = originalHtml;
    }, 2000);
  });
};

// New session button
document.getElementById('btn-new-session').onclick = () => {
  const newSessionId = generateSessionId();
  const newUrl = getSessionUrl(newSessionId);
  window.open(newUrl, '_blank');
  showAlert('New session opened in new tab', 'info');
};

// Download button
document.getElementById('btn-download').onclick = () => {
  const text = editor.getText();
  const title = document.getElementById('document-title').value || 'Untitled';
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showAlert(`Downloaded "${title}.txt"`, 'success');
};

// Clear All button
const clearAllModal = new bootstrap.Modal(document.getElementById('clearAllModal'));

document.getElementById('btn-clear').onclick = () => {
  clearAllModal.show();
};

document.getElementById('btn-confirm-clear-all').onclick = () => {
  editor.setText('');
  showAlert('All content cleared', 'info');
  clearAllModal.hide();
};

// File upload
document.getElementById('file-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    editor.setText(event.target.result);
    const fileName = file.name.replace(/\.[^/.]+$/, '');
    document.getElementById('document-title').value = fileName;
    
    // Update current page name
    saveCurrentPage();
    
    showAlert(`Uploaded "${file.name}"`, 'success');
  };
  reader.onerror = () => {
    showAlert('Failed to upload file', 'error');
  };
  reader.readAsText(file);
  e.target.value = ''; // Reset input
});

// Document title sync
document.getElementById('document-title').addEventListener('change', (e) => {
  console.log('Title changed to:', e.target.value);
  saveCurrentPage(); // Save immediately when title is manually changed (on blur/enter)
});

// ===== THEME TOGGLE =====
const getStoredTheme = () => localStorage.getItem('theme');
const setStoredTheme = theme => localStorage.setItem('theme', theme);

const getPreferredTheme = () => {
  const storedTheme = getStoredTheme();
  if (storedTheme) {
    return storedTheme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const setTheme = theme => {
  if (theme === 'auto') {
    document.documentElement.setAttribute('data-bs-theme', 
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-bs-theme', theme);
  }
};

// Set theme on load
setTheme(getPreferredTheme());

// Theme toggle buttons
document.querySelectorAll('[data-bs-theme-value]').forEach(button => {
  button.addEventListener('click', () => {
    const theme = button.getAttribute('data-bs-theme-value');
    setStoredTheme(theme);
    setTheme(theme);
    
    // Update active state
    document.querySelectorAll('[data-bs-theme-value]').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');
  });
  
  // Set initial active state
  if (button.getAttribute('data-bs-theme-value') === getPreferredTheme()) {
    button.classList.add('active');
  }
});

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const storedTheme = getStoredTheme();
  if (storedTheme !== 'light' && storedTheme !== 'dark') {
    setTheme(getPreferredTheme());
  }
});

// ===== MOBILE SIDEBAR TOGGLE =====
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebar = document.querySelector('.sidebar');

if (sidebarToggleBtn && sidebar) {
  sidebarToggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('active');
    
    // Change icon based on state
    const icon = sidebarToggleBtn.querySelector('i');
    if (sidebar.classList.contains('active')) {
      icon.className = 'bi bi-x-lg';
    } else {
      icon.className = 'bi bi-layout-sidebar-inset-reverse';
    }
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 991) {
      if (sidebar.classList.contains('active') && 
          !sidebar.contains(e.target) && 
          !sidebarToggleBtn.contains(e.target)) {
        sidebar.classList.remove('active');
        const icon = sidebarToggleBtn.querySelector('i');
        icon.className = 'bi bi-layout-sidebar-inset-reverse';
      }
    }
  });
}
