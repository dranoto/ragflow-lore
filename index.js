// DIAGNOSTIC: Check what's available in the global scope
console.log('[RAGFlow-DEBUG] Starting extension load...');
console.log('[RAGFlow-DEBUG] typeof eventSource:', typeof eventSource);
console.log('[RAGFlow-DEBUG] typeof getContext:', typeof getContext);
console.log('[RAGFlow-DEBUG] typeof require:', typeof require);

// Try to get dependencies - handle both ES6 imports and CommonJS/global approaches
let eventSource, event_types, saveSettingsDebounced, getContext;

try {
    // Try ES6 import first (may fail in older SillyTavern versions)
    const extensionsModule = require('../../extensions.js');
    eventSource = extensionsModule.eventSource;
    event_types = extensionsModule.event_types;
    saveSettingsDebounced = extensionsModule.saveSettingsDebounced;
    getContext = extensionsModule.getContext;
    console.log('[RAGFlow-DEBUG] Loaded via CommonJS require()');
} catch (e) {
    console.error('[RAGFlow-DEBUG] CommonJS require() failed:', e);
    // Fall back to globals
    console.log('[RAGFlow-DEBUG] Trying global variables...');
    eventSource = window.eventSource;
    event_types = window.event_types;
    saveSettingsDebounced = window.saveSettingsDebounced;
    getContext = window.getContext;
}

// Validate we have the required dependencies
if (typeof getContext !== 'function') {
    console.error('[RAGFlow-DEBUG] CRITICAL: getContext is not a function! Extension cannot load.');
    console.error('[RAGFlow-DEBUG] Available globals:', Object.keys(window).filter(k => k.includes('event') || k.includes('context') || k.includes('extension')));
    throw new Error('getContext function not available');
}

console.log('[RAGFlow-DEBUG] Dependencies loaded successfully');

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
    const context = getContext();
    const settings = context.extension_settings[extensionName];
    
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
        const context = getContext();
        const settings = context.extension_settings[extensionName];
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
    const context = getContext();
    const settings = context.extension_settings[extensionName] || { ...defaultSettings };
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

// 5. Registration
(function registerExtension() {
    console.log('[RAGFlow-DEBUG] Starting registration IIFE...');

    try {
        const context = getContext();
        console.log('[RAGFlow-DEBUG] Got context:', context);
        console.log('[RAGFlow-DEBUG] typeof context:', typeof context);
        console.log('[RAGFlow-DEBUG] context keys:', context ? Object.keys(context) : 'null');

        // Ensure settings object is initialized
        console.log('[RAGFlow-DEBUG] Checking extension_settings...');
        if (!context.extension_settings) {
            console.error('[RAGFlow-DEBUG] CRITICAL: context.extension_settings is undefined!');
            throw new Error('context.extension_settings not available');
        }

        if (!context.extension_settings[extensionName]) {
            console.log('[RAGFlow-DEBUG] Initializing settings...');
            context.extension_settings[extensionName] = { ...defaultSettings };
        }

        // Check registration method
        console.log('[RAGFlow-DEBUG] typeof context.registerExtension:', typeof context.registerExtension);

        if (typeof context.registerExtension !== 'function') {
            console.error('[RAGFlow-DEBUG] CRITICAL: context.registerExtension is not a function!');
            console.error('[RAGFlow-DEBUG] Available methods:', Object.keys(context).filter(k => typeof context[k] === 'function'));
            throw new Error('registerExtension method not available');
        }

        // Standard Registration
        console.log('[RAGFlow-DEBUG] Calling registerExtension...');
        context.registerExtension({
            name: "RAGFlow Lore Injector",
            id: extensionName,
            init: () => {
                console.log("[RAGFlow] Extension Loaded.");
                setupEventListeners();
            },
            settings: buildSettingsMenu
        });
        console.log('[RAGFlow-DEBUG] registerExtension completed');

        // Explicitly register settings to force the gear icon to appear
        console.log('[RAGFlow-DEBUG] typeof context.registerExtensionSettings:', typeof context.registerExtensionSettings);
        if (context.registerExtensionSettings) {
            console.log('[RAGFlow-DEBUG] Calling registerExtensionSettings...');
            context.registerExtensionSettings(extensionName, buildSettingsMenu);
            console.log('[RAGFlow-DEBUG] registerExtensionSettings completed');
        }

        console.log('[RAGFlow-DEBUG] Registration completed successfully!');
    } catch (error) {
        console.error('[RAGFlow-DEBUG] ERROR during registration:', error);
        console.error('[RAGFlow-DEBUG] Error stack:', error.stack);
        console.error('[RAGFlow-DEBUG] Error name:', error.name);
        console.error('[RAGFlow-DEBUG] Error message:', error.message);
        // Re-throw to let SillyTavern catch it
        throw error;
    }
})();