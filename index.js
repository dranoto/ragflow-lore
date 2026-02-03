// RAGFlow Lore Injector - Index.js
// Aligned strictly with the st-extension-example pattern

import { 
    extension_settings, 
    getContext, 
    loadExtensionSettings, 
    eventSource, 
    event_types 
} from "../../../extensions.js";

// NOTE: The example assumes 'scripts/extensions/third-party/extension-name' (Depth 4).
// If you are in 'scripts/extensions/ragflow-lore' (Depth 3), this import might need to be '../../script.js'.
// We will stick to the example's depth.
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "ragflow-lore";

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

// Global state
let pendingLore = "";

// 2. Core Logic (RAGFlow Interaction)
async function fetchRagflowContext(query) {
    const settings = extension_settings[extensionName];
    
    if (!settings.apiKey || !settings.datasetId) return null;

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
        toastr.error('RAGFlow search failed. Check console.');
        return null;
    }
}

// 3. Settings Management (Matches Example Logic)
async function loadSettings() {
    // Ensure the settings object exists
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    
    // Assign defaults if keys are missing
    const settings = extension_settings[extensionName];
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
    }

    // Update UI elements to match settings
    $("#ragflow_enabled").prop("checked", settings.enabled);
    $("#ragflow_baseUrl").val(settings.baseUrl);
    $("#ragflow_apiKey").val(settings.apiKey);
    $("#ragflow_datasetId").val(settings.datasetId);
    $("#ragflow_maxChunks").val(settings.maxChunks);
    $("#ragflow_similarity").val(settings.similarityThreshold);
}

function onSettingChange(event) {
    const id = event.target.id;
    const settings = extension_settings[extensionName];
    
    // Update settings object based on input ID
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

// 4. Initialization (The Standard Way)
jQuery(async () => {
    // Inline HTML Template (Replacing the $.get call from the example)
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
                    <input type="text" class="text_pole" id="ragflow_baseUrl" />
                </div>
                <div class="flex-container">
                    <label>API Key</label>
                    <input type="password" class="text_pole" id="ragflow_apiKey" />
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
                    <label>Similarity</label>
                    <input type="number" class="text_pole" id="ragflow_similarity" step="0.1" />
                </div>
            </div>
        </div>
    </div>
    `;

    // Append to the settings menu (Standard ST Location)
    $("#extensions_settings").append(settingsHtml);

    // Bind Listeners
    $("#ragflow_enabled").on("change", onSettingChange);
    $("#ragflow_baseUrl").on("input", onSettingChange);
    $("#ragflow_apiKey").on("input", onSettingChange);
    $("#ragflow_datasetId").on("input", onSettingChange);
    $("#ragflow_maxChunks").on("input", onSettingChange);
    $("#ragflow_similarity").on("input", onSettingChange);

    // Initial Load
    loadSettings();

    // Setup Logic Listeners
    eventSource.on(event_types.chat_input_handling, async (data) => {
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;
        
        pendingLore = "";
        const userQuery = data.text;
        if (!userQuery || userQuery.trim().length < 5) return;

        console.log('[RAGFlow] Fetching...', userQuery);
        const result = await fetchRagflowContext(userQuery);
        if (result) {
            pendingLore = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
            console.log('[RAGFlow] Context ready.');
        }
    });

    eventSource.on(event_types.chat_completion_prompt_ready, (data) => {
        if (pendingLore && data.system_prompt !== undefined) {
            data.system_prompt += pendingLore;
            console.log("[RAGFlow] Injected.");
        }
    });

    console.log("[RAGFlow] Loaded successfully.");
});