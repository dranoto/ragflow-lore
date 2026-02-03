// RAGFlow Lore Injector - Index.js
// Rewritten to match the SillyTavern "Classic" Extension pattern

import { 
    extension_settings, 
    getContext, 
    loadExtensionSettings, 
    eventSource, 
    event_types 
} from "../../../extensions.js";

// Import saveSettingsDebounced from the main script (adjust path if needed based on your folder depth)
// The example repo uses ../../../../script.js, assuming: scripts/extensions/third-party/your-extension/
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "ragflow-lore";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

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

// Global state for the current generation cycle
let pendingLore = "";

// 2. Core Logic

async function fetchRagflowContext(query) {
    const settings = extension_settings[extensionName];
    
    if (!settings.apiKey || !settings.datasetId) return null;

    // Ensure URL doesn't end with slash
    const cleanUrl = settings.baseUrl.replace(/\/$/, '');
    const url = `${cleanUrl}/api/v1/datasets/${settings.datasetId}/search`;
    
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

        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const data = await response.json();
        
        let chunks = [];
        // Handle different RAGFlow response structures
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
        toastr.error('RAGFlow search failed. Check console for details.');
        return null;
    }
}

function setupEventListeners() {
    // Listener 1: Capture input and fetch context
    eventSource.on(event_types.chat_input_handling, async (data) => {
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;
        
        pendingLore = "";
        const userQuery = data.text;
        
        // Skip short queries
        if (!userQuery || userQuery.trim().length < 5) return;

        console.log('[RAGFlow] Fetching context for:', userQuery);
        const result = await fetchRagflowContext(userQuery);
        
        if (result) {
            pendingLore = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
            console.log('[RAGFlow] Context ready for injection.');
        }
    });

    // Listener 2: Inject into System Prompt immediately before generation
    eventSource.on(event_types.chat_completion_prompt_ready, (data) => {
        if (pendingLore) {
            if (data.system_prompt !== undefined) {
                // Append to system prompt
                data.system_prompt += pendingLore;
                console.log("[RAGFlow] Injected into System Prompt.");
            } else {
               console.log("[RAGFlow] Could not find system_prompt to inject.");
            }
        }
    });
}

// 3. Settings & UI Management

async function loadSettings() {
    // Initialize default settings if they don't exist
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];

    // Merge defaults to ensure all keys exist
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
    }

    // Update UI elements with current settings values
    $("#ragflow_enabled").prop("checked", settings.enabled);
    $("#ragflow_baseUrl").val(settings.baseUrl);
    $("#ragflow_apiKey").val(settings.apiKey);
    $("#ragflow_datasetId").val(settings.datasetId);
    $("#ragflow_maxChunks").val(settings.maxChunks);
    $("#ragflow_similarity").val(settings.similarityThreshold);
}

// Generic handler for input changes
function onSettingChange(event) {
    const id = event.target.id;
    const settings = extension_settings[extensionName];
    
    switch (id) {
        case "ragflow_enabled":
            settings.enabled = !!$(event.target).prop("checked");
            break;
        case "ragflow_baseUrl":
            settings.baseUrl = $(event.target).val();
            break;
        case "ragflow_apiKey":
            settings.apiKey = $(event.target).val();
            break;
        case "ragflow_datasetId":
            settings.datasetId = $(event.target).val();
            break;
        case "ragflow_maxChunks":
            settings.maxChunks = parseInt($(event.target).val());
            break;
        case "ragflow_similarity":
            settings.similarityThreshold = parseFloat($(event.target).val());
            break;
    }
    
    saveSettingsDebounced();
}

// 4. Main Initialization (jQuery Ready)

jQuery(async () => {
    // Define HTML template inline (or load from file if preferred)
    // We use the "inline-drawer" class structure to match ST's native look
    const settingsHtml = `
    <div class="ragflow-extension-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>RAGFlow Lore Injector</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="flex-container">
                    <label class="checkbox_label">
                        <input type="checkbox" id="ragflow_enabled" />
                        Enable RAGFlow Lore
                    </label>
                </div>
                
                <div class="flex-container">
                    <label>Base URL</label>
                    <input type="text" class="text_pole" id="ragflow_baseUrl" placeholder="http://localhost:9380" />
                </div>
                
                <div class="flex-container">
                    <label>API Key</label>
                    <input type="password" class="text_pole" id="ragflow_apiKey" placeholder="ragflow-..." />
                </div>

                <div class="flex-container">
                    <label>Dataset ID</label>
                    <input type="text" class="text_pole" id="ragflow_datasetId" />
                </div>

                <div class="flex-container">
                    <label>Max Chunks</label>
                    <input type="number" class="text_pole" id="ragflow_maxChunks" min="1" max="10" />
                </div>

                <div class="flex-container">
                    <label>Similarity Threshold</label>
                    <input type="number" class="text_pole" id="ragflow_similarity" step="0.1" min="0" max="1" />
                </div>
                
                <div class="flex-container">
                    <small><i>Status: See browser console (F12) for injection logs.</i></small>
                </div>
            </div>
        </div>
    </div>
    `;

    // Append to the extension settings menu
    $("#extensions_settings").append(settingsHtml);

    // Bind event listeners to the inputs we just created
    $("#ragflow_enabled").on("change", onSettingChange);
    $("#ragflow_baseUrl").on("input", onSettingChange);
    $("#ragflow_apiKey").on("input", onSettingChange);
    $("#ragflow_datasetId").on("input", onSettingChange);
    $("#ragflow_maxChunks").on("input", onSettingChange);
    $("#ragflow_similarity").on("input", onSettingChange);

    // Initial loading of settings
    loadSettings();

    // Start extension listeners
    setupEventListeners();
    
    console.log("[RAGFlow] Extension initialized.");
});