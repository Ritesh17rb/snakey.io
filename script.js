import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { QuillBinding } from 'y-quill';
import Quill from 'quill';
import QuillCursors from 'quill-cursors';
import diff from "fast-diff";
import { demoScenarios, agentConfigurations } from './demo-documents.js';
import { AgentManager } from './agent-manager.js';
import { extractTextFromPDF, isPDFFile } from './pdf-utils.js';
import config from './config.js';

// Register Cursors Module
Quill.register('modules/cursors', QuillCursors);

// Register Custom Agent Attribute for Highlighting
const Parchment = Quill.import('parchment');
const AgentIdAttribute = new Parchment.Attributor.Class('agent-id', 'agent-id', {
  scope: Parchment.Scope.INLINE
});
Quill.register(AgentIdAttribute);

// Global state for highlight
let highlightedAgentId = null;

// Helper to toggle highlight (Global)
window.toggleAgentHighlight = function(agentId, color) {
  // Remove previous rules
  const oldStyle = document.getElementById('agent-highlight-style');
  if (oldStyle) oldStyle.remove();
  
  // If clicking same agent, turn off
  if (highlightedAgentId === agentId) {
    highlightedAgentId = null;
    return;
  }
  
  highlightedAgentId = agentId;
  
  // Add new rule
  const style = document.createElement('style');
  style.id = 'agent-highlight-style';
  style.innerHTML = `
    .agent-id-${agentId} {
      background-color: ${color}40; /* 25% opacity */
      border-bottom: 2px solid ${color};
    }
  `;
  document.head.appendChild(style);
};

// ===== GLOBAL STATE =====
let currentScenario = null;
let activeAgents; // Track active agents (Synced)
let userIsTyping = false;
let lastUserActivity = Date.now();

// Remove duplicate agentManager since we are using Yjs for coordination now
// Or keep it for local IDs, but we will mostly rely on Yjs
const agentManager = new AgentManager();

// ===== UTILITY FUNCTIONS =====
function log(msg, type = 'info') {
  const logs = document.getElementById('logs');
  const timestamp = new Date().toLocaleTimeString();
  const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '📝';
  logs.innerHTML += `<div class="mb-1"><small class="text-muted">${timestamp}</small> ${icon} ${msg}</div>`;
  logs.scrollTop = logs.scrollHeight;
}

// ===== YJS SETUP =====
const ydoc = new Y.Doc();
activeAgents = ydoc.getMap('active-agents-data');
const ytext = ydoc.getText('quill');

const urlParams = new URLSearchParams(window.location.search);
let roomName = urlParams.get('room');
if (!roomName) {
  roomName = 'doc-' + Math.random().toString(36).substring(2, 7);
  window.history.replaceState({}, '', `?room=${roomName}`);
}

const persistence = new IndexeddbPersistence(roomName, ydoc);
persistence.on('synced', () => log('Local storage synced', 'success'));

const provider = new WebrtcProvider(roomName, ydoc, {
  signaling: [
    'wss://signaling-server-2s0k.onrender.com'
  ]
});

provider.on('status', event => {
  const dot = document.getElementById('connection-status-dot');
  const text = document.getElementById('connection-status-text');
  if (dot && text) {
      if (event.connected) {
          log('Connected to collaboration server', 'success');
          dot.classList.replace('bg-warning', 'bg-success');
          text.innerText = "Connected";
      } else {
          log('Disconnected from server', 'error');
          dot.classList.replace('bg-success', 'bg-warning');
          text.innerText = "Connecting...";
      }
  }
});

// ===== USER AWARENESS =====
const COLORS = [
  { color: '#FF3333', light: '#FFD6D6' },
  { color: '#FFAA33', light: '#FFF5D6' },
  { color: '#33AA33', light: '#D6F5D6' },
  { color: '#3333FF', light: '#D6D6FF' },
  { color: '#AA33AA', light: '#F5D6F5' }
];

const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
const welcomeModal = new bootstrap.Modal(document.getElementById('welcomeModal'));
const nameInput = document.getElementById('user-name-input');

window.addEventListener('load', () => {
  const storedName = localStorage.getItem('synapse_username');
  if (storedName) {
    nameInput.value = storedName;
    joinSession();
  } else {
    welcomeModal.show();
  }
  initializeDemoCards();
});

function joinSession() {
  const rawName = nameInput.value.trim();
  if (!rawName) {
    alert("Please enter a name!");
    return;
  }
  
  provider.awareness.setLocalStateField('user', {
    name: rawName,
    color: myColor.color
  });

  welcomeModal.hide();
  localStorage.setItem('synapse_username', rawName);
  log(`Joined as ${rawName}`, 'success');
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
  });
};

provider.awareness.on('change', () => {
  const count = provider.awareness.getStates().size;
  document.getElementById('user-count').innerText = count;
  updateAgentActivity(); // Also update the activity list to show users
});

// ===== EDITOR SETUP =====
const editor = new Quill('#editor-container', {
  theme: 'snow',
  modules: { 
    cursors: true,
    toolbar: [['bold', 'italic'], [{ header: 1 }, { header: 2 }], ['clean']] 
  },
  placeholder: 'Start typing or load a demo scenario...'
});

const binding = new QuillBinding(ytext, editor, provider.awareness);

// Track user typing activity for UI feedback only (not for pausing agents)
let typingTimeout = null;

editor.on('text-change', (delta, oldDelta, source) => {
  if (source === 'user') {
    // User is typing - just update UI, don't pause agents
    if (!userIsTyping) {
      userIsTyping = true;
      log('You are editing - agents continue working in parallel', 'info');
      updateAgentActivity(); // Update UI to show parallel editing
    }
    
    lastUserActivity = Date.now();
    
    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    // Reset typing flag after 2 seconds of inactivity
    typingTimeout = setTimeout(() => {
      if (Date.now() - lastUserActivity >= 2000) {
        userIsTyping = false;
        updateAgentActivity(); // Update UI
      }
    }, 2000);
  }
});

// ===== DEMO CARDS INITIALIZATION =====
function initializeDemoCards() {
  const container = document.getElementById('demo-cards-container');
  
  Object.entries(demoScenarios).forEach(([key, scenario]) => {
    const card = document.createElement('div');
    card.className = 'col-md-6 col-lg-4';
    card.innerHTML = `
      <div class="card h-100 demo-card" style="cursor: pointer;" data-scenario="${key}">
        <div class="card-body">
          <h6 class="card-title d-flex align-items-center mb-3">
            <i class="bi ${scenario.icon} fs-4 text-primary me-2"></i>
            ${scenario.title}
          </h6>
          <p class="card-text small text-muted">${scenario.description}</p>
        </div>
      </div>
    `;
    
    card.querySelector('.demo-card').addEventListener('click', () => {
      loadScenario(key);
    });
    
    container.appendChild(card);
  });
}

// ===== LOAD SCENARIO =====
let currentAbortController = null;

function loadScenario(scenarioKey) {
  // Cancel previous agents if any
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  // Clear running agents
  activeAgents.forEach((_, id) => {
    removeAgent(id);
    removeAICursor(id);
  });
  activeAgents.clear();
  
  // Hide parent card
  const parentCard = document.getElementById('parent-agent-card');
  if (parentCard) parentCard.style.display = 'none';

  currentScenario = scenarioKey;
  const scenario = demoScenarios[scenarioKey];
  
  // Update UI
  document.querySelectorAll('.demo-card').forEach(card => {
    card.classList.remove('active');
  });
  document.querySelector(`[data-scenario="${scenarioKey}"]`).classList.add('active');
  
  document.getElementById('document-title').textContent = scenario.title;
  
  // Load document content
  editor.clipboard.dangerouslyPasteHTML(0, scenario.document);
  
  // Load sample prompts
  loadSamplePrompts(scenario.samplePrompts);
  
  log(`Loaded: ${scenario.title}`, 'success');
}

// ===== SAMPLE PROMPTS =====
function loadSamplePrompts(prompts) {
  const container = document.getElementById('sample-prompts-container');
  
  // Clear previous content
  container.innerHTML = '';
  
  if (!prompts || prompts.length === 0) {
    return;
  }
  
  prompts.forEach(prompt => {
    // Create a "chip" style element
    const promptEl = document.createElement('button');
    promptEl.className = 'btn btn-outline-primary btn-sm rounded-pill d-flex align-items-center gap-2 mb-2 me-2';
    promptEl.title = prompt.description; // Tooltip for description
    promptEl.innerHTML = `
      <i class="bi bi-magic"></i>
      <span>${prompt.text}</span>
    `;
    
    promptEl.addEventListener('click', () => {
      document.getElementById('custom-prompt').value = prompt.text;
      triggerMultiAgentAI();
      // Scroll to editor or focus logic could go here
    });
    
    container.appendChild(promptEl);
  });
}

// Observe shared agent state
activeAgents.observe(() => {
  updateAgentActivity();
});

function updateAgentActivity() {
  const container = document.getElementById('agent-activity-container');
  const countBadge = document.getElementById('active-agents-count');
  
  // Clear container
  container.innerHTML = '';
  
  // 1. SHOW CONNECTED USERS (Collaborators)
  const states = provider.awareness.getStates();
  let onlineUsers = 0;
  
  states.forEach((state, clientId) => {
    // Skip if it's us? No, show us too so we see what others see? 
    // Usually "Collaborators" lists everyone.
    // The user said "see him... and he see me".
    if (state.user && state.user.name) {
       onlineUsers++;
       const isMe = clientId === provider.awareness.clientID;
       const userEl = document.createElement('div');
       userEl.className = 'agent-item p-2 mb-2 bg-body rounded';
       // Use a different border style for humans
       userEl.style.borderLeft = `4px solid ${state.user.color}`;
       userEl.style.backgroundColor = isMe ? 'rgba(var(--bs-primary-rgb), 0.05)' : '';
       
       userEl.innerHTML = `
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <span class="agent-status-dot" style="background-color: ${state.user.color}; animation: none;"></span>
            <strong class="small">${state.user.name} ${isMe ? '(You)' : ''}</strong>
          </div>
          <span class="badge bg-primary-subtle text-primary">Human</span>
        </div>
        <div class="small text-muted mt-1">
          <i class="bi bi-pencil-square me-1"></i>Collaborator
        </div>
       `;
       container.appendChild(userEl);
    }
  });

  // Separator if we have both users and agents
  if (onlineUsers > 0 && activeAgents.size > 0) {
     const hr = document.createElement('hr');
     hr.className = 'my-2 opacity-25';
     container.appendChild(hr);
  }

  // 2. SHOW AI AGENTS
  if (activeAgents.size === 0 && onlineUsers === 0) {
    container.innerHTML = '<p class="text-muted text-center small mb-0">No active agents or users</p>';
    if (countBadge) countBadge.textContent = '0 Active';
    return;
  }
  
  // Update total count (Agents + Users) or just Agents?
  // The badge ID is 'active-agents-count'. Let's keep it for agents for now, or total?
  // "He should be able to see me and the agents".
  // Let's update badge to show total activity.
  if (countBadge) countBadge.textContent = `${activeAgents.size + onlineUsers} Active`;

  // Show parallel editing indicator if user is typing
  if (userIsTyping) {
    const parallelIndicator = document.createElement('div');
    parallelIndicator.className = 'alert alert-info py-2 px-3 mb-2 small';
    parallelIndicator.innerHTML = '<i class="bi bi-people-fill me-2"></i><strong>Parallel Editing</strong> - content updates live';
    container.prepend(parallelIndicator);
  }
  
  activeAgents.forEach((agentJson, agentId) => {
    const agent = typeof agentJson === 'string' ? JSON.parse(agentJson) : agentJson;
    
    // Fallback for color if missing
    const color = agent.color || '#6c757d';

    const agentEl = document.createElement('div');
    // Only animate if not completed
    const isWorking = agent.status !== 'Completed';
    agentEl.className = `agent-item p-2 mb-2 bg-body rounded ${isWorking ? 'working' : ''}`;
    agentEl.style.borderLeftColor = color;
    agentEl.style.cursor = 'pointer'; // Make clickable
    agentEl.title = isWorking ? "Working..." : "Click to highlight edits";
    agentEl.onclick = () => window.toggleAgentHighlight(agentId, color);
    
    // Status Badge Color
    let badgeClass = 'bg-success-subtle text-success';
    if (agent.status === 'Completed') badgeClass = 'bg-secondary-subtle text-secondary';
    if (agent.status === 'Analyze') badgeClass = 'bg-warning-subtle text-warning';

    agentEl.innerHTML = `
      <div class="d-flex align-items-center justify-content-between">
        <div>
          <span class="agent-status-dot" style="background-color: ${color}; animation: ${isWorking ? 'blink 1.5s infinite' : 'none'}"></span>
          <strong class="small">${agent.name}</strong>
        </div>
        <span class="badge ${badgeClass}">${agent.status}</span>
      </div>
      <div class="small text-muted mt-1">
        <i class="bi bi-geo-alt me-1"></i>${agent.section}
      </div>
      <div class="small text-muted">
        <i class="bi bi-list-task me-1"></i>${agent.task}
      </div>
    `;
    
    // Prepend to show latest agents on top
    container.prepend(agentEl);
  });
}

function addAgent(agentConfig) {
  // Store as string to be safe with Yjs Map value types
  activeAgents.set(agentConfig.id, JSON.stringify({
    ...agentConfig,
    status: 'Working'
  }));
}

function removeAgent(agentId) {
  activeAgents.delete(agentId);
}

function updateAgentStatus(agentId, status) {
  if (activeAgents.has(agentId)) {
    const current = JSON.parse(activeAgents.get(agentId));
    current.status = status;
    activeAgents.set(agentId, JSON.stringify(current));
  }
}

// ===== SECTION DETECTION =====
function findSectionInDocument(sectionKeyword) {
  const content = editor.getText();
  const lines = content.split('\n');
  
  // Try to find section by keyword
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase();
    if (line.includes(sectionKeyword.toUpperCase())) {
      // Calculate character position
      let position = 0;
      for (let j = 0; j < i; j++) {
        position += lines[j].length + 1; // +1 for newline
      }
      
      // Find end of section (next heading or end of document)
      let endPosition = content.length;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        // Check if it's a heading (starts with number or all caps)
        if (/^[0-9]+\./.test(nextLine) || /^[A-Z\s]{10,}$/.test(nextLine)) {
          endPosition = 0;
          for (let k = 0; k < j; k++) {
            endPosition += lines[k].length + 1;
          }
          break;
        }
      }
      
      return { start: position, end: endPosition, text: content.substring(position, endPosition) };
    }
  }
  
  // If not found, return a random section
  const sectionLength = Math.floor(content.length / 4);
  const start = Math.floor(Math.random() * (content.length - sectionLength));
  return { start, end: start + sectionLength, text: content.substring(start, start + sectionLength) };
}

// ===== AI CURSOR MANAGEMENT =====
const aiCursors = ydoc.getMap('ai-cursors');

function updateAICursor(agentId, index, color, name) {
  const relPos = Y.createRelativePositionFromTypeIndex(ytext, index);
  const encoded = Y.encodeRelativePosition(relPos);
  aiCursors.set(agentId, { position: encoded, color, name: name || agentId });
}

function removeAICursor(agentId) {
  aiCursors.delete(agentId);
}

// Listen for AI cursor updates
const knownAICursorIds = new Set();

aiCursors.observe(() => {
  const cursorsModule = editor.getModule('cursors');
  const currentIds = new Set(aiCursors.keys());
  
  // 1. Remove deleted cursors
  knownAICursorIds.forEach(id => {
      if (!currentIds.has(id)) {
          cursorsModule.removeCursor(id);
          knownAICursorIds.delete(id);
      }
  });

  // 2. Update/Create current cursors
  aiCursors.forEach((cursorData, agentId) => {
    knownAICursorIds.add(agentId); // Track it
    
    if (!cursorData.position) {
      cursorsModule.removeCursor(agentId);
      return;
    }
    
    try {
      const relPos = Y.decodeRelativePosition(cursorData.position);
      const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
      
      if (absPos && absPos.index !== null) {
        // Create or update cursor
        cursorsModule.createCursor(agentId, cursorData.name || agentId, cursorData.color);
        cursorsModule.moveCursor(agentId, { index: absPos.index, length: 0 });
      }
    } catch (e) {
      console.error("Error updating AI cursor:", e);
    }
  });
});

// ===== LLM CALL =====
async function callLLM(messages, onChunk) {
  const apiKey = localStorage.getItem('llm_api_key');
  const baseUrl = localStorage.getItem('llm_url') || 'https://api.openai.com/v1';

  // Helper function for simulation (Shared logic)
  const runSimulation = async () => {
      // Enhanced simulation with agent-specific content
      const mockTexts = {
        'agent-parties': ' [Verified: All party information is accurate and complete. Legal entities properly identified.] ',
        'agent-liability': ' [Reviewed: Liability caps are reasonable. Indemnification clauses are balanced.] ',
        'agent-ip': ' [Analyzed: IP ownership clearly defined. Licensing terms are appropriate.] ',
        'agent-abstract': ' [Enhanced: Abstract now includes key findings and methodology summary.] ',
        'agent-methodology': ' [Improved: Technical descriptions are clearer and more reproducible.] ',
        'agent-results': ' [Verified: All data presentations are accurate and properly formatted.] ',
        'agent-references': ' [Checked: All citations are properly formatted and complete.] ',
        'agent-executive': ' [Enhanced: Value proposition is now more compelling and clear.] ',
        'agent-financial': ' [Verified: All financial calculations and projections are accurate.] ',
        'agent-technical': ' [Improved: Technical solution descriptions are more detailed.] '
      };
      
      const agentId = messages[0]?.content?.match(/You are (\S+)/)?.[1] || 'agent';
      const mock = mockTexts[agentId] || ' [AI-generated improvement text based on your request.] ';
      
      for (const char of mock.split('')) {
        await new Promise(r => setTimeout(r, 40));
        onChunk(char);
      }
  };

  if (!apiKey) {
    log('⚠ No API Key. Simulating AI typing...', 'info');
    await runSimulation();
    return;
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ 
        model: config.defaultModel || 'gpt-4o-mini', 
        messages, 
        stream: true,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }

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
              for (const char of content) {
                await new Promise(r => setTimeout(r, 30));
                onChunk(char);
              }
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.name === 'TypeError') {
         log("⚠ Connection refused. Using simulation.", 'warning');
         await runSimulation();
    } else {
         log("AI Error: " + e.message, 'error');
    }
  }
}

// ===== GENERATE AGENT NAME BASED ON TASK =====
async function generateAgentName(task, section) {
  const apiKey = localStorage.getItem('llm_api_key');
  const baseUrl = localStorage.getItem('llm_url') || 'https://api.openai.com/v1';

  // Fallback names if no API key
  if (!apiKey) {
    const taskKeywords = task.toLowerCase();
    if (taskKeywords.includes('verify') || taskKeywords.includes('check')) return 'Verification Specialist';
    if (taskKeywords.includes('review') || taskKeywords.includes('analyze')) return 'Analysis Expert';
    if (taskKeywords.includes('enhance') || taskKeywords.includes('improve')) return 'Enhancement Specialist';
    if (taskKeywords.includes('simplify') || taskKeywords.includes('concise')) return 'Simplification Specialist';
    if (taskKeywords.includes('financial') || taskKeywords.includes('number')) return 'Financial Analyst';
    if (taskKeywords.includes('technical') || taskKeywords.includes('architecture')) return 'Technical Writer';
    if (taskKeywords.includes('legal') || taskKeywords.includes('compliance')) return 'Legal Compliance Reviewer';
    return 'Content Specialist';
  }

  try {
    const prompt = `Given this task: "${task}" for section "${section}", generate a concise, professional agent name (2-3 words max) that describes what this agent does. 

Examples:
- Task: "Verify all party names and addresses" → "Parties Verifier"
- Task: "Review limitation of liability clauses" → "Liability Checker"
- Task: "Analyze intellectual property provisions" → "IP Rights Analyst"
- Task: "Improve abstract clarity and accuracy" → "Abstract Enhancer"
- Task: "Verify financial calculations" → "Financial Auditor"

Respond with ONLY the agent name, nothing else.`;

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ 
        model: config.defaultModel || 'gpt-4o-mini', 
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 20
      })
    });

    const data = await response.json();
    const generatedName = data.choices[0]?.message?.content?.trim();
    
    if (generatedName && generatedName.length > 0 && generatedName.length < 50) {
      return generatedName;
    }
  } catch (e) {
    console.error("Error generating agent name:", e);
  }

  // Fallback to section-based name
  return `${section} Agent`;
}

// ===== SINGLE AGENT EXECUTION =====
async function runSingleAgent(agentConfig) {
  // Generate dynamic agent name based on task
  const dynamicName = await generateAgentName(agentConfig.task, agentConfig.section);
  agentConfig.name = dynamicName;
  
  addAgent(agentConfig);
  log(`${agentConfig.name} started working on ${agentConfig.section}`, 'info');
  
  // Find the section in the document
  const section = findSectionInDocument(agentConfig.section);
  let currentIndex = section.start;
  
  // Prepare the prompt
  const prompt = `You are ${agentConfig.name}, a specialized AI agent. Your task: ${agentConfig.task}

Section content to improve:
"""
${section.text.substring(0, 1000)}
"""

Provide ONLY the improved text for this section. Be concise and focused. Write naturally without meta-commentary.`;

  const messages = [{ role: 'user', content: prompt }];
  
  // Update agent status
  updateAgentStatus(agentConfig.id, 'Analyzing');
  
  // Wait a bit before starting to avoid overwhelming
  await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
  
  updateAgentStatus(agentConfig.id, 'Writing');
  


// Stream and insert text
  try {
      await callLLM(messages, async (chunk) => {
        if (currentAbortController && currentAbortController.signal.aborted) {
             throw new Error("Aborted");
        }
        
        // If user is typing, wait briefly instead of skipping
        while (userIsTyping) {
          await new Promise(r => setTimeout(r, 100));
        }
        
        ydoc.transact(() => {
          // INSERT WITH ATTRIBUTES
          ytext.insert(currentIndex, chunk, { 'agent-id': agentConfig.id });
          currentIndex += chunk.length;
          updateAICursor(agentConfig.id, currentIndex, agentConfig.color, agentConfig.name);
        });
      });
  } catch(e) {
      if (e.message === "Aborted") {
          log(`${agentConfig.name} stopped.`, 'warning');
          removeAICursor(agentConfig.id);
          removeAgent(agentConfig.id);
          return;
      }
      throw e;
  }
  
  // Cleanup
  removeAICursor(agentConfig.id);
  // Do NOT remove agent - keep it for highlighting history
  updateAgentStatus(agentConfig.id, 'Completed');
  log(`${agentConfig.name} completed work`, 'success');
}

// ===== ORCHESTRATION =====
async function orchestrateAndSpawn(instruction) {
  const apiKey = localStorage.getItem('llm_api_key');
  const baseUrl = localStorage.getItem('llm_url') || 'https://api.openai.com/v1';

  // Helper check for connection
  const isSimulation = !apiKey;

  if (isSimulation) {
    log('⚠ Simulation Mode (No API Key).', 'info');
    runSimulationOrchestration(instruction);
    return;
  }

  // Show parent agent UI
  const parentCard = document.getElementById('parent-agent-card');
  if (parentCard) {
      parentCard.style.display = 'block';
      document.getElementById('parent-status').innerText = 'Planning';
      document.getElementById('parent-analysis').innerText = `Analyzing request: "${instruction}"...`;
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ 
        model: config.defaultModel || 'gpt-4o-mini', 
        messages: [
            {
                role: "system",
                content: `You are a Lead Editor. Break the user's request into 2 to 3 parallezable sub-tasks.
RETURN JSON ONLY: { "tasks": [{ "name": "string (Agent Name)", "role": "string", "instruction": "string", "section_context": "string (which part of doc)" }] }`
            },
            { role: "user", content: instruction }
        ],
        response_format: { type: "json_object" }
      })
    });
    
    // Check for HTTP errors (like 401, 500)
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let plan = { tasks: [] };
    try {
        plan = JSON.parse(data.choices[0].message.content);
    } catch (e) {
        log("Failed to parse plan JSON", "error");
    }

    if (plan.tasks && plan.tasks.length > 0) {
        executePlan(plan, parentCard);
    } else {
        // Fallback
        const config = { task: instruction, section: 'General', color: '#8b5cf6', name: 'Editor' };
        runAutonomousAgent(config);
    }

  } catch (e) {
    console.error("Orchestration Error:", e);
    
    // Fallback to simulation if connection fails
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.name === 'TypeError') {
        log(`⚠ Connection failed. Switching to simulation mode.`, 'warning');
        runSimulationOrchestration(instruction);
    } else {
        log(`Orchestration failed: ${e.message}`, 'error');
        const config = { task: instruction, section: 'General', color: '#8b5cf6', name: 'Editor' };
        runAutonomousAgent(config);
    }
  }
}

// Separate function for executing a valid plan
async function executePlan(plan, parentCard) {
    if (parentCard) {
         document.getElementById('parent-status').innerText = 'Delegating';
         document.getElementById('parent-analysis').innerText = `Created ${plan.tasks.length} sub-tasks.`;
    }
    
    // Spawn agents
    const promises = [];
    for (const task of plan.tasks) {
         const colors = ['#FF3333', '#FFAA33', '#33AA33', '#3333FF', '#AA33AA'];
         const randomColor = colors[Math.floor(Math.random() * colors.length)];
         
         const config = {
             name: task.name,
             role: task.role,
             task: task.instruction,
             section: task.section_context,
             color: randomColor
         };
         promises.push(runAutonomousAgent(config));
         await wait(300); // slight stagger
    }
    
    // Wait for all sub-tasks to complete
    await Promise.all(promises);

    // Final Review
    if (parentCard) {
         document.getElementById('parent-status').innerText = 'Final Review';
         document.getElementById('parent-analysis').innerText = 'Checking entire document for quality...';
    }
    log("👨‍🏫 Supervisor: Starting final document verification...", "info");
    
    const supervisorConfig = {
        name: "Supervisor",
        role: "Lead Editor",
        task: "Review the entire document. Correct any inconsistencies, typos, or awkward phrasing introduced by previous edits. ensure the document is cohesive.",
        section: "Whole Document",
        color: "#000000"
    };
    await runAutonomousAgent(supervisorConfig);

    if (parentCard) {
       document.getElementById('parent-status').innerText = 'Done';
       document.getElementById('parent-analysis').innerText = 'All tasks completed.';
       setTimeout(() => { parentCard.style.display = 'none'; }, 3000);
    }
}

// Fallback Simulation for Orchestration
function runSimulationOrchestration(instruction) {
    const parentCard = document.getElementById('parent-agent-card');
    if (parentCard) {
        parentCard.style.display = 'block';
        document.getElementById('parent-status').innerText = 'Planning (Simulated)';
        document.getElementById('parent-analysis').innerText = `Simulating plan for: "${instruction}"`;
    }

    setTimeout(() => {
        // Create fake plan
        const plan = {
            tasks: [
                { name: 'Drafter', role: 'Writer', instruction: 'Drafting content', section_context: 'Body' },
                { name: 'Reviewer', role: 'Editor', instruction: 'Reviewing style', section_context: 'Intro' }
            ]
        };
        executePlan(plan, parentCard);
    }, 1000);
}

// ===== INDEPENDENT AGENT EXECUTION =====
async function runAutonomousAgent(agentConfig) {
  // 1. Immediate UI Registration (with temp name if needed)
  if (!agentConfig.name) {
      agentConfig.name = "Pending Agent..."; // Temp name
  }
  
  // Register with AgentManager (Show in UI immediately)
  const agentId = agentManager.spawnAgent(agentConfig);
  agentConfig.id = agentId;
  addAgent(agentConfig); // Ensure UI element is created
  
  // 2. Generate Real Name (if needed)
  if (agentConfig.name === "Pending Agent...") {
      try {
           const dynamicName = await generateAgentName(agentConfig.task, agentConfig.section);
           agentConfig.name = dynamicName;
           // Update UI
           updateAgentStatus(agentId, 'starting'); // Triggers status update
           // We might need to update the Name text in DOM, but AgentManager primarily tracks status.
           // Let's force update the list visual if we can, or just log it.
           // For now, removing and re-adding, or updating specific element if logic existed.
           // Simplest: The status update below will show activity.
           log(`${dynamicName} assigned to task.`, 'info');
      } catch (e) {
           agentConfig.name = "Task Agent";
      }
  }

  log(`${agentConfig.name} started working.`, 'info');
  
  try {
    updateAgentStatus(agentId, 'reading');
  
    // 1. Get Context (Section or Whole Doc)
    let currentText = ytext.toString();
    updateAgentStatus(agentId, 'working');

    const apiKey = localStorage.getItem('llm_api_key');
    const baseUrl = localStorage.getItem('llm_url') || 'https://api.openai.com/v1';

    if (!apiKey) {
       // Mock mode
       updateAgentStatus(agentId, 'simulating');
       const mockText = " [AI Verified: " + agentConfig.task + "] ";
       ydoc.transact(() => {
           ytext.insert(ytext.length, mockText);
       }, agentId);
       await wait(1000);
       agentManager.completeAgent(agentId);
       removeAgent(agentId);
       return;
    }

    // --- PHASE 1: EXECUTION ---
    agentManager.updateAgentStatus(agentId, 'reading');

    agentManager.updateAgentStatus(agentId, 'working');

    // Query LLM for Edits
    let response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ 
        model: 'gpt-4o', 
        messages: [
            {
                role: "system",
                content: `You are ${agentConfig.name}. Return JSON: { operations: [{ match: "exact unique string to replace", replacement: "new content" }] }. 
RULES:
1. "match" MUST exist in the document exactly.
2. PRESERVE WHITESPACE: If your replacement merges words (e.g. "hello world" -> "helloworld"), adding spaces.
3. If changing a word, include the preceding space in "match" and "replacement" to be safe, or just ensure replacement has same spacing.`
            },
            {
                role: "user",
                content: `Document:\n${currentText}\n\nTask: ${agentConfig.task}\nSection: ${agentConfig.section}`
            }
        ],
        response_format: { 
            type: "json_schema", 
            json_schema: {
                name: "contract_edit",
                schema: {
                    type: "object",
                    properties: {
                        operations: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    match: { type: "string" },
                                    replacement: { type: "string" }
                                },
                                required: ["match", "replacement"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["operations"],
                    additionalProperties: false
                }
            } 
        }
      })
    });

    let data = await response.json();
    let operations = [];
    try {
        operations = JSON.parse(data.choices[0].message.content).operations || [];
    } catch (e) {
        log(`${agentConfig.name} produced no valid edits.`, 'warning');
    }

    if (operations.length > 0) {
        log(`${agentConfig.name} applying ${operations.length} edits...`, 'info');
        await applyOperations(operations, agentId, agentConfig.name, agentConfig.color);
    }

    // --- PHASE 2: SELF-VERIFICATION ---
    updateAgentStatus(agentId, 'verifying');
    // Read text again to see my own changes
    currentText = ytext.toString(); 
    
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ 
        model: 'gpt-4o', 
        messages: [
            {
                role: "system",
                content: `You are ${agentConfig.name}. Verify if your previous task was completed correctly in the document. 
If mistakes remain, provide fix operations. If correct, return empty operations array.
RETURN JSON: { operations: [{ match: "string", replacement: "string" }] }`
            },
            {
                role: "user",
                content: `Current Document:\n${currentText}\n\nYour Task: ${agentConfig.task}`
            }
        ],
        response_format: { 
            type: "json_schema", 
            json_schema: {
                name: "contract_edit",
                schema: {
                    type: "object",
                    properties: {
                        operations: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    match: { type: "string" },
                                    replacement: { type: "string" }
                                },
                                required: ["match", "replacement"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["operations"],
                    additionalProperties: false
                }
            } 
        }
      })
    });

    data = await response.json();
    let fixOperations = [];
    try {
        fixOperations = JSON.parse(data.choices[0].message.content).operations || [];
    } catch (e) {}

    if (fixOperations.length > 0) {
        log(`${agentConfig.name} found ${fixOperations.length} corrections. Applying...`, 'warning');
        updateAgentStatus(agentId, 'fixing');
        await applyOperations(fixOperations, agentId, agentConfig.name, agentConfig.color);
    } else {
        log(`${agentConfig.name} verified work: OK.`, 'success');
    }

    agentManager.completeAgent(agentId);
    await wait(2500);

  } catch (error) {
    agentManager.failAgent(agentId, error.message);
    log(`${agentConfig.name} error: ${error.message}`, 'error');
  } finally {
    // Cleanup - remove from UI (Active Agents List)
    removeAICursor(agentConfig.id);
    removeAgent(agentConfig.id);
  }
}

// ===== PARALLEL MULTI-AGENT EXECUTION =====
// ===== PARALLEL MULTI-AGENT EXECUTION =====
async function triggerMultiAgentAI() {
  const instructionInput = document.getElementById('custom-prompt');
  const instruction = instructionInput.value.trim();
  
  if (instruction.length > 0) {
      // 1. Immediate UI Feedback
      instructionInput.value = ''; 
      log(`🧠 Analyzing request: "${instruction}"...`, 'info');
      // 2. Delegate to Parent Agent for Planning & Execution
      await orchestrateAndSpawn(instruction);
      return;
  }

  // Fallback: If no input, try scenario agents
  if (!currentScenario) {
    log('Please load a demo scenario or type a specific task!', 'warning');
    return;
  }
  
  const agents = agentConfigurations[currentScenario];
  if (!agents || agents.length === 0) {
    log('No agents configured for this scenario', 'error');
    return;
  }
  
  log(`🚀 Launching ${agents.length} scenario agents...`, 'success');
  
  // Run all agents in parallel
  const agentPromises = agents.map(agent => runAutonomousAgent(agent));
  
  await Promise.all(agentPromises);
  
  log('✨ All agents finished!', 'success');
}

// ===== SINGLE AI TRIGGER (Original functionality) =====
async function triggerSingleAI() {
  const instruction = document.getElementById('custom-prompt').value;
  if (!instruction) return;

  const statusEl = document.getElementById('ai-status');
  statusEl.classList.remove('d-none');
  statusEl.innerText = "AI Working...";
  
  const range = editor.getSelection();
  let index = range ? range.index : ytext.length;
  let length = range ? range.length : 0;

  if (length > 0) {
    ydoc.transact(() => {
      ytext.delete(index, length);
    });
  }

  const allText = ytext.toString();
  const context = allText.substring(Math.max(0, index - 500), Math.min(allText.length, index + 500));
  
  const prompt = `You are an expert editor. Context: "...${context}...". Instruction: ${instruction}. WRITE TEXT ONLY.`;

  log("Single AI agent starting work...");

  await callLLM([{role: 'user', content: prompt}], (chunk) => {
    if (userIsTyping) return; // Pause if user is typing
    
    ydoc.transact(() => {
      ytext.insert(index, chunk);
      index += chunk.length;
    });
  });

  statusEl.innerText = "Done";
  setTimeout(() => {
    statusEl.classList.add('d-none');
  }, 2000);
}

// ===== EVENT LISTENERS =====
document.getElementById('btn-trigger').addEventListener('click', () => {
  const hasInstruction = document.getElementById('custom-prompt').value.trim().length > 0;
  const hasScenarioAgents = currentScenario && agentConfigurations[currentScenario];

  if (hasInstruction || hasScenarioAgents) {
    triggerMultiAgentAI();
  } else {
    triggerSingleAI();
  }
});



// Template buttons
document.querySelectorAll('.template-btn').forEach(btn => {
  btn.onclick = () => {
    const templates = {
      "MSA": `<h1 style="text-align: center;">MASTER SERVICES AGREEMENT</h1><p><strong>1. PARTIES.</strong> Agreement made between [Party A] and [Party B].</p>`,
      "NDA": `<h1 style="text-align: center;">NON-DISCLOSURE AGREEMENT</h1><p><strong>1. CONFIDENTIALITY.</strong> The parties agree to keep information secret.</p>`
    };
    const type = btn.getAttribute('data-template');
    editor.clipboard.dangerouslyPasteHTML(editor.getLength(), templates[type]);
  };
});

// File Upload Handler (PDF and Text)
// File Upload Handler (PDF and Text)
const fileUploadInput = document.getElementById('file-upload');
if (fileUploadInput) {
  fileUploadInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      log(`Uploading ${file.name}...`, 'info');
      let textContent = '';

      if (isPDFFile(file)) {
        // Extract text from PDF
        log('Extracting text from PDF...', 'info');
        textContent = await extractTextFromPDF(file);
        log('PDF text extracted successfully', 'success');
      } else {
        // Read as plain text
        textContent = await file.text();
      }

      // Replace document content
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, textContent);
      }, 'file-upload');

      document.getElementById('document-title').textContent = file.name;
      log(`Loaded ${file.name} (${textContent.length} characters)`, 'success');
      
    } catch (error) {
      log(`Failed to load file: ${error.message}`, 'error');
      console.error('File upload error:', error);
    } finally {
      // Reset input
      event.target.value = '';
    }
  });
}

// Share Button Logic
document.getElementById('btn-share').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(window.location.href);
        log('📋 Link copied as URL', 'success');
        
        // Visual feedback on button
        const btn = document.getElementById('btn-share');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Copied';
        btn.classList.replace('btn-outline-light', 'btn-success');
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.replace('btn-success', 'btn-outline-light');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy: ', err);
        log('Failed to copy link.', 'error');
    }
});

// LLM Config
function populateModelSelect() {
  const select = document.getElementById('llm-model');
  select.innerHTML = '';
  const currentModel = config.defaultModel || 'gpt-4o-mini';
  
  config.availableModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.text = model;
      if (model === currentModel) option.selected = true;
      select.appendChild(option);
  });
}

document.getElementById('save-llm-config').onclick = () => {
  localStorage.setItem('llm_api_key', document.getElementById('llm-api-key').value);
  localStorage.setItem('llm_url', document.getElementById('llm-url').value);
  
  // Save model selection
  const selectedModel = document.getElementById('llm-model').value;
  config.defaultModel = selectedModel; // Update runtime config
  // In a real app we'd persist this too, maybe in localStorage
  localStorage.setItem('llm_model', selectedModel);

  bootstrap.Modal.getInstance(document.getElementById('llmConfigModal')).hide();
  log(`Settings saved. Model: ${selectedModel}`, 'success');
};

// Initialize Config Modal
document.getElementById('llm-api-key').value = localStorage.getItem('llm_api_key') || '';
document.getElementById('llm-url').value = localStorage.getItem('llm_url') || '';
// Load saved model if exists
const savedModel = localStorage.getItem('llm_model');
if (savedModel) config.defaultModel = savedModel;
populateModelSelect();

// New Session Logic
document.getElementById('btn-new-session').onclick = () => {
    if(confirm("Start a new session? This will clear the current document and disconnect you from the current room.")) {
        // Simple reload without query params to generate a new room
        window.location.href = window.location.pathname;
    }
};

// ===== SMART EDITING HELPERS =====
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applySmartDiff(oldText, newText, agentId, name, color) {
  const changes = diff(oldText, newText);
  let headAnchor = Y.createRelativePositionFromTypeIndex(ytext, 0);

  for (const [action, chunk] of changes) {
    if (action === 0) { // EQ
      // Move anchor
      const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, ydoc);
      if (startPos) {
        headAnchor = Y.createRelativePositionFromTypeIndex(ytext, startPos.index + chunk.length);
      }
    } else if (action === -1) { // DEL
      const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, ydoc);
      if (startPos) {
        updateAICursor(agentId, startPos.index, color, name);
        await wait(25);
        ydoc.transact(() => {
          ytext.delete(startPos.index, chunk.length);
        }, agentId);
        // Head anchor stays at startPos (content shifted)
      }
    } else if (action === 1) { // INS
      const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, ydoc);
      if (startPos) {
        let instAnchor = Y.createRelativePositionFromTypeIndex(ytext, startPos.index);
        for (const char of chunk) {
          const abs = Y.createAbsolutePositionFromRelativePosition(instAnchor, ydoc);
          if (abs) {
            updateAICursor(agentId, abs.index, color, name);
            ydoc.transact(() => {
              ytext.insert(abs.index, char);
            }, agentId);
            instAnchor = Y.createRelativePositionFromTypeIndex(ytext, abs.index + 1);
          }
           await wait(5); // fast typing effect
        }
        headAnchor = instAnchor;
      }
    }
  }
}

async function applyOperations(operations, agentId, name, color) {
    for (const op of operations) {
        const match = op.match;
        const replacement = op.replacement;
        if (!match) continue;

        let anchorRelPos = null;
        let found = false;
        let startIndex = -1;

        // 1. Locate and Delete (Instant)
        // 1. Locate and Delete (Instant)
        ydoc.transact(() => {
            const current = ytext.toString();
            // Search safely
            let idx = current.indexOf(match);
            
            // Fallback: try trimmed
            if (idx === -1) {
                idx = current.indexOf(match.trim());
            }

            if (idx !== -1) {
                startIndex = idx;
                // Delete the old text
                ytext.delete(idx, match.length); // Note: might be off if trimmed, but good enough for now
                // Create an anchor where we want to start typing
                anchorRelPos = Y.createRelativePositionFromTypeIndex(ytext, idx);
                found = true;
            }
        }, agentId);

        if (!found) {
             console.log(`Could not find match for replacement: "${match.slice(0,10)}..."`);
             continue;
        }

        log(`${name} rewriting...`, "info");
        
        // 2. Slow "Human-like" Typing
        for (let i = 0; i < replacement.length; i++) {
            const char = replacement[i];
            
            // Adjust speed: faster for long texts to avoid boring the user, but visible
            // 20ms is fast typing, 50ms is slow. 
            // Let's use a variable speed for realism.
            const delay = Math.random() * 30 + 15; 
            await wait(delay); 

            ydoc.transact(() => {
                const absPos = Y.createAbsolutePositionFromRelativePosition(anchorRelPos, ydoc);
                if (absPos) {
                    // INSERT WITH ATTRIBUTE
                    ytext.insert(absPos.index, char, { 'agent-id': agentId });
                    updateAICursor(agentId, absPos.index + 1, color, name);
                    
                    // Update anchor to point to the NEXT simulated cursor position
                    anchorRelPos = Y.createRelativePositionFromTypeIndex(ytext, absPos.index + 1);
                }
            }, agentId);
        }
    }
}
