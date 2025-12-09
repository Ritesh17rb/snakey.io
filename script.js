import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { QuillBinding } from 'y-quill';
import Quill from 'quill';
import QuillCursors from 'quill-cursors'; // <--- NEW IMPORT

// --- 0. REGISTER CURSORS ---
Quill.register('modules/cursors', QuillCursors);

// --- 1. CONFIG & UTILS ---
const templates = {
  "MSA": `<h1 style="text-align: center;">MASTER SERVICES AGREEMENT</h1><p><strong>1. PARTIES.</strong> Agreement made between [Party A] and [Party B].</p>`,
  "NDA": `<h1 style="text-align: center;">NON-DISCLOSURE AGREEMENT</h1><p><strong>1. CONFIDENTIALITY.</strong> The parties agree to keep information secret.</p>`
};

function log(msg) {
  const logs = document.getElementById('logs');
  logs.innerHTML += `<div>> ${msg}</div>`;
  logs.scrollTop = logs.scrollHeight;
}

// --- 2. SETUP YJS ---
const ydoc = new Y.Doc();
const ytext = ydoc.getText('quill');

const urlParams = new URLSearchParams(window.location.search);
let roomName = urlParams.get('room');
if (!roomName) {
    roomName = 'doc-' + Math.random().toString(36).substring(2, 7);
    window.history.replaceState({}, '', `?room=${roomName}`);
}

const persistence = new IndexeddbPersistence(roomName, ydoc);
persistence.on('synced', () => log('Local storage loaded.'));

const provider = new WebrtcProvider(roomName, ydoc, {
    signaling: [
        'wss://signaling-server-2s0k.onrender.com', 
        // 'wss://y-webrtc.fly.dev',
        // 'wss://signaling.yjs.dev'
    ]
});

provider.on('status', event => {
    if(event.connected) log('Connected to collaboration server.');
    else log('Connecting to peers...');
});

// --- 3. AWARENESS (USER COLORS & NAMES) ---
const COLORS = [
    { color: '#FF3333', light: '#FFD6D6', name: 'Red' },
    { color: '#FFAA33', light: '#FFF5D6', name: 'Orange' },
    { color: '#33AA33', light: '#D6F5D6', name: 'Green' },
    { color: '#3333FF', light: '#D6D6FF', name: 'Blue' },
    { color: '#AA33AA', light: '#F5D6F5', name: 'Purple' }
];

// Pick a color for the user
const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];

// Initialize UI
const welcomeModal = new bootstrap.Modal(document.getElementById('welcomeModal'));
const nameInput = document.getElementById('user-name-input');

// Show modal on load
window.addEventListener('load', () => {
    welcomeModal.show();
});

// Handle Join
function joinSession() {
    const rawName = nameInput.value.trim();
    if (!rawName) {
        alert("Please enter a name!");
        return;
    }
    
    // Set awareness
    provider.awareness.setLocalStateField('user', {
        name: rawName,
        color: myColor.color
    });

    welcomeModal.hide();
    log(`Joined as ${rawName}`);
}

document.getElementById('btn-join').onclick = joinSession;
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinSession();
});

// Share functionality
document.getElementById('btn-share').onclick = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        const btn = document.getElementById('btn-share');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Copied!';
        btn.classList.replace('btn-outline-primary', 'btn-success');
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.replace('btn-success', 'btn-outline-primary');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
};

provider.awareness.on('change', () => {
    document.getElementById('user-count').innerText = provider.awareness.getStates().size;
});

// --- 4. EDITOR SETUP (WITH CURSORS) ---
const editor = new Quill('#editor-container', {
    theme: 'snow',
    modules: { 
        cursors: true, // <--- ENABLE CURSORS MODULE
        toolbar: [['bold', 'italic'], [{ header: 1 }, { header: 2 }], ['clean']] 
    },
    placeholder: 'Start typing...'
});

const binding = new QuillBinding(ytext, editor, provider.awareness);

// --- 5. AI LOGIC (PARALLEL EDITING) ---

// We use a shared Map to track the AI's cursor position across all clients.
// This avoids creating a second WebRTC provider (which causes errors) while still
// allowing everyone to see the AI's cursor in real-time.
const aiState = ydoc.getMap('ai-state');
const AI_CURSOR_ID = 'ai-agent-cursor';

// Listen for AI cursor updates from ANY user (the AI host)
aiState.observe(() => {
    const encodedPos = aiState.get('cursor');
    const cursorsModule = editor.getModule('cursors');
    
    if (!encodedPos) {
        cursorsModule.removeCursor(AI_CURSOR_ID);
        return;
    }

    // Decode position (Relative -> Absolute) ensuring it stays correct even if text moves
    try {
        const relPos = Y.decodeRelativePosition(encodedPos);
        const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
        
        if (absPos) {
            cursorsModule.createCursor(AI_CURSOR_ID, 'AI Co-Pilot', '#0d6efd'); // Blue
            cursorsModule.moveCursor(AI_CURSOR_ID, { index: absPos.index, length: 0 });
            cursorsModule.toggleFlag(AI_CURSOR_ID, true); // Always show name
        }
    } catch (e) {
        console.error("Error updating AI cursor:", e);
    }
});

// Helper to update AI cursor execution
function updateAICursor(index) {
    const relPos = Y.createRelativePositionFromTypeIndex(ytext, index);
    const encoded = Y.encodeRelativePosition(relPos);
    aiState.set('cursor', encoded);
}

async function callLLM(messages, onChunk) {
    const apiKey = localStorage.getItem('llm_api_key');
    const baseUrl = localStorage.getItem('llm_url') || 'https://api.openai.com/v1';

    if (!apiKey) {
        log('⚠ No API Key. Simulating AI typing...');
        // Simulation for demo
        const mock = " Here is some drafted text from the AI agent, appearing in real-time. ";
        for (const char of mock.split('')) {
            await new Promise(r => setTimeout(r, 80)); // Typing speed
            onChunk(char);
        }
        return;
    }

    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages, stream: true })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const content = JSON.parse(line.substring(6)).choices[0]?.delta?.content;
                        if (content) {
                            // Slow down typing: Emit character by character with delay
                            for (const char of content) {
                                await new Promise(r => setTimeout(r, 50));
                                onChunk(char);
                            }
                        }
                    } catch (e) {}
                }
            }
        }
    } catch (e) {
        log("AI Error: " + e.message);
    }
}

async function triggerAI() {
    const instruction = document.getElementById('custom-prompt').value;
    if (!instruction) return;

    const statusEl = document.getElementById('ai-status');
    statusEl.classList.remove('d-none');
    statusEl.innerText = "AI Joining...";
    
    // 1. Get current selection from main editor
    const range = editor.getSelection();
    let index = range ? range.index : ytext.length;
    let length = range ? range.length : 0;

    // 2. Perform initial operations (Delete selection if any)
    if (length > 0) {
        ydoc.transact(() => {
            ytext.delete(index, length);
        });
        // After delete, length is essentially 0 at that index
    }

    // 3. Prepare Prompt context
    const allText = ytext.toString();
    const context = allText.substring(Math.max(0, index - 500), Math.min(allText.length, index + 500));
    
    const prompt = `You are an expert legal co-author. Context: "...${context}...". Instruction: ${instruction}. WRITE TEXT ONLY.`;

    log("AI Agent starting work...");

    // 4. Stream & Type (Update Main Doc + Shared AI Cursor)
    await callLLM([{role: 'user', content: prompt}], (chunk) => {
        ydoc.transact(() => {
            ytext.insert(index, chunk);
            index += chunk.length;
            updateAICursor(index); // Broadcast cursor move
        });
    });

    statusEl.innerText = "Done";
    setTimeout(() => {
        statusEl.classList.add('d-none');
        aiState.set('cursor', null); // clear cursor
    }, 2000);
}

// --- 6. EVENT LISTENERS ---
document.getElementById('btn-trigger').addEventListener('click', triggerAI);

document.querySelectorAll('.template-btn').forEach(btn => {
    btn.onclick = () => {
        const type = btn.getAttribute('data-template');
        // Templates still inserted by YOU, so use main editor
        editor.clipboard.dangerouslyPasteHTML(editor.getLength(), templates[type]);
    };
});

document.getElementById('save-llm-config').onclick = () => {
    localStorage.setItem('llm_api_key', document.getElementById('llm-api-key').value);
    localStorage.setItem('llm_url', document.getElementById('llm-url').value);
    bootstrap.Modal.getInstance(document.getElementById('llmConfigModal')).hide();
    log("Settings saved.");
};

document.getElementById('llm-api-key').value = localStorage.getItem('llm_api_key') || '';