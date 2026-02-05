export {};

// Import for user-scoped extensions
import '../../../../public/global';
// Import for server-scoped extensions  
import '../../../../global';

declare global {
    // RAGFlow Lore Injector Extension Types
    namespace SillyTavern {
        interface ExtensionSettings {
            'ragflow-lore'?: {
                enabled: boolean;
                baseUrl: string;
                apiKey: string;
                datasetId: string;
                similarityThreshold: number;
                maxChunks: number;
                useKg: boolean;
                keyword: boolean;
                rerankId: string;
                timeout: number;
                injectPrefix: string;
                injectSuffix: string;
                mode: 'auto' | 'manual' | 'disabled';
                debugMode: boolean;
                showPreview: boolean;
                keepInHistory: boolean;
                perChatSettings: Record<string, string>;
            };
        }
    }
}
