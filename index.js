import { eventSource, event_types, saveSettingsDebounced, getContext } from '../../../../scripts/extensions.js';

// 1. Default Settings
const defaultSettings = {
    enabled: true,
    baseUrl: 'http://localhost:9380',
    apiKey: '',
    datasetId: '',
    similarityThreshold: 0.5,
    maxChunks: 3,
    // We inject this into the "System" prompt so the character knows it's knowledge, not dialogue.
    injectPrefix: '\n[Relevant excerpts from the original novel for this scene:\n',
    injectSuffix: '\n]\n'
};

const extensionName = "ragflow-lore";
const context = getContext();

// Variable to hold the fetched lore temporarily
let pendingLore = "";

// Ensure settings exist
if (!context.extension_settings[extensionName]) {
    context.extension_settings[extensionName] = { ...defaultSettings };
}

const getSettings = () => context.extension_settings[extensionName];

// 2. RAGFlow API Interaction
async function fetchRagflowContext(query) {
    const settings = getSettings();
    if (!settings.apiKey || !settings.datasetId) return null;

    const url = `${settings.baseUrl.replace(/\/$/, '')}/api/v1/datasets/${settings.datasetId}/search`;
    
    // Clean query: remove "Scrooge" or names to focus on the topic, or keep them for context. 
    // Keeping user input as-is is usually best.
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: query,
                similarity_threshold: parseFloat(settings.similarityThreshold),
                top_k: parseInt(settings.maxChunks)
            })
        });

        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        
        let chunks = [];
        if (data.data && Array.isArray(data.data.rows)) {
            chunks = data.data.rows.map(row => row.content_with_weight || row.content);
        } else if (Array.isArray(data.chunks)) {
            chunks = data.chunks.map(c => c.content_with_weight || c.content);
        } else if (Array.isArray(data.results)) {
            chunks = data.results.map(r => r.content || r.text);
        }

        if (chunks.length === 0) return null;
        return chunks.join('\n...\n');
    } catch (error) {
        console.error('[RAGFlow] Search failed:', error);
        return null;
    }
}

// 3. EVENT 1: Fetch Data when you hit Send
// We use 'chat_input_handling' to perform the fetch asynchronously while the UI processes your message.
eventSource.on(event_types.chat_input_handling, async (data) => {
    const settings = getSettings();
    if (!settings.enabled) return;
    
    // Reset previous lore
    pendingLore = "";

    const userQuery = data.text;
    if (!userQuery || userQuery.trim().length < 5) return;

    // Fetch and store in the global variable
    const result = await fetchRagflowContext(userQuery);
    if (result) {
        pendingLore = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
        console.log('[RAGFlow] Context ready for injection.');
    }
});

// 4. EVENT 2: Inject into Prompt silently
// 'chat_completion_prompt_ready' fires right before the request goes to the AI.
// We append our stored lore to the system prompt or after the chat history.
eventSource.on(event_types.chat_completion_prompt_ready, (data) => {
    if (pendingLore) {
        // Option A: Append to System Prompt (Strongest instruction, invisible to user)
        // Checks if system_prompt exists in the data object (standard in ST)
        if (data.system_prompt) {
            data.system_prompt += pendingLore;
        } 
        // Option B: Fallback - Prepend to the last message (User's message) effectively
        // but this might be visible depending on the backend.
        // We will stick to modifying the extension_prompt if available, or system_prompt.
        else {
           console.log("[RAGFlow] Could not find system_prompt to inject.");
        }
        
        console.log("[RAGFlow] Injected into System Prompt.");
    }
});

// 5. Build Settings UI (Same as before)
function buildSettingsMenu() {
    const settings = getSettings();
    const container = document.createElement('div');
    container.className = 'ragflow-settings-container';

    const html = `
        <h3>RAGFlow Configuration</h3>
        <label>
            Enable RAGFlow Lore
            <input type="checkbox" id="ragflow_enabled" ${settings.enabled ? 'checked' : ''}>
        </label>
        <label>Base URL <input type="text" id="ragflow_baseUrl" value="${settings.baseUrl}"></label>
        <label>API Key <input type="password" id="ragflow_apiKey" value="${settings.apiKey}"></label>
        <label>Dataset ID <input type="text" id="ragflow_datasetId" value="${settings.datasetId}"></label>
        <label>Max Chunks <input type="number" id="ragflow_maxChunks" value="${settings.maxChunks}" min="1" max="10"></label>
        <label>Sim Threshold <input type="number" id="ragflow_similarity" value="${settings.similarityThreshold}" step="0.1"></label>
        <div class="ragflow-status">Status: ${pendingLore ? 'Lore Loaded' : 'Idle'}</div>
    `;

    container.innerHTML = html;
    
    const inputs = container.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            settings.enabled = container.querySelector('#ragflow_enabled').checked;
            settings.baseUrl = container.querySelector('#ragflow_baseUrl').value;
            settings.apiKey = container.querySelector('#ragflow_apiKey').value;
            settings.datasetId = container.querySelector('#ragflow_datasetId').value;
            settings.maxChunks = parseInt(container.querySelector('#ragflow_maxChunks').value);
            settings.similarityThreshold = parseFloat(container.querySelector('#ragflow_similarity').value);
            saveSettingsDebounced();
        });
    });
    return container;
}

jQuery(async () => {
    if (context.registerExtensionSettings) {
        context.registerExtensionSettings(extensionName, buildSettingsMenu);
    }
});