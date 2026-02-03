// Import necessary functions from SillyTavern extensions.js
// Based on the working extension pattern provided
import { 
    getContext, 
    loadExtensionSettings, 
    extension_settings, 
    renderExtensionTemplateAsync,
    registerExtension,
    eventSource, 
    event_types, 
    saveSettingsDebounced 
} from '../../../extensions.js';

console.log('[RAGFlow-DEBUG] Starting extension load...');
console.log('[RAGFlow-DEBUG] Imports loaded successfully');
console.log('[RAGFlow-DEBUG] typeof getContext:', typeof getContext);
console.log('[RAGFlow-DEBUG] typeof eventSource:', typeof eventSource);
console.log('[RAGFlow-DEBUG] typeof event_types:', typeof event_types);
console.log('[RAGFlow-DEBUG] typeof saveSettingsDebounced:', typeof saveSettingsDebounced);
console.log('[RAGFlow-DEBUG] typeof extension_settings:', typeof extension_settings);
console.log('[RAGFlow-DEBUG] typeof renderExtensionTemplateAsync:', typeof renderExtensionTemplateAsync);
console.log('[RAGFlow-DEBUG] typeof registerExtension:', typeof registerExtension);

// 1. Default Settings
const defaultSettings = {
    enabled: true,
    baseUrl: 'http://localhost:9380',
    apiKey: '',
    datasetId: '',
    similarityThreshold: 0.5,
    maxChunks: 3,
    injectPrefix: '\n[Relevant excerpts from the original novel for this scene:\n',
    injectSuffix: '\n]\n'
};

const extensionName = "ragflow-lore";
let pendingLore = "";

// 2. RAGFlow API Interaction
async function fetchRagflowContext(query) {
    const settings = extension_settings[extensionName];
    
    if (!settings.apiKey || !settings.datasetId) return null;

    const url = `${settings.baseUrl.replace(/\/$/, '')}/api/v1/datasets/${settings.datasetId}/search`;
    
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

// 3. Event Listeners
function setupEventListeners() {
    eventSource.on(event_types.chat_input_handling, async (data) => {
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;
        
        pendingLore = "";
        const userQuery = data.text;
        if (!userQuery || userQuery.trim().length < 5) return;

        const result = await fetchRagflowContext(userQuery);
        if (result) {
            pendingLore = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
            console.log('[RAGFlow] Context ready for injection.');
        }
    });

    eventSource.on(event_types.chat_completion_prompt_ready, (data) => {
        if (pendingLore) {
            if (data.system_prompt) {
                data.system_prompt += pendingLore;
                console.log("[RAGFlow] Injected into System Prompt.");
            } else {
               console.log("[RAGFlow] Could not find system_prompt to inject.");
            }
        }
    });
}

// 4. Build Settings UI
function buildSettingsMenu() {
    const settings = extension_settings[extensionName] || { ...defaultSettings };
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
            extension_settings[extensionName].enabled = container.querySelector('#ragflow_enabled').checked;
            extension_settings[extensionName].baseUrl = container.querySelector('#ragflow_baseUrl').value;
            extension_settings[extensionName].apiKey = container.querySelector('#ragflow_apiKey').value;
            extension_settings[extensionName].datasetId = container.querySelector('#ragflow_datasetId').value;
            extension_settings[extensionName].maxChunks = parseInt(container.querySelector('#ragflow_maxChunks').value);
            extension_settings[extensionName].similarityThreshold = parseFloat(container.querySelector('#ragflow_similarity').value);
            saveSettingsDebounced();
        });
    });
    return container;
}

// 5. Registration
(function registerExtension() {
    console.log('[RAGFlow-DEBUG] Starting registration...');

    try {
        // Initialize settings if they don't exist
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = { ...defaultSettings };
            console.log('[RAGFlow-DEBUG] Settings initialized');
        }

        // Register the extension with SillyTavern
        console.log('[RAGFlow-DEBUG] Registering extension...');
        registerExtension({
            name: "RAGFlow Lore Injector",
            id: extensionName,
            init: () => {
                console.log("[RAGFlow] Extension Loaded.");
                setupEventListeners();
            },
            settings: buildSettingsMenu
        });
        
        console.log('[RAGFlow-DEBUG] Registration completed successfully!');
    } catch (error) {
        console.error('[RAGFlow-DEBUG] ERROR during registration:', error);
        console.error('[RAGFlow-DEBUG] Error stack:', error.stack);
        throw error;
    }
})();