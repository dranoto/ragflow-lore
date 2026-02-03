RAGFlow Lore Injector for SillyTavern

This extension connects your SillyTavern chat to a RAGFlow Knowledge Base. It queries RAGFlow before every message, retrieves relevant "chunks" (text from your books/docs), and injects them into the prompt.

Installation

Create a folder named ragflow-lore inside your SillyTavern installation:
/public/scripts/extensions/ragflow-lore/

Place index.js, manifest.json, and style.css into that folder.

Refresh SillyTavern.

Configuration

Open the Extensions menu (the puzzle piece icon).

Find RAGFlow Lore Injector and click the settings (gear) icon or the enabled toggle.

Enter your details:

Base URL: usually http://localhost:9380 (or wherever your RAGFlow docker container is running).

API Key: Get this from your RAGFlow console.

Dataset ID: The ID of the knowledge base you want to query.

Troubleshooting

CORS Errors:
If you see "Network Error" or CORS issues in the browser console (F12), it is because RAGFlow running on port 9380 is rejecting requests from SillyTavern running on port 8000.

You may need to configure RAGFlow (Nginx) to allow CORS from your SillyTavern URL, or run SillyTavern and RAGFlow behind the same reverse proxy.

Quick Fix for CORS (Dev only):
You can use a browser extension like "Allow CORS: Access-Control-Allow-Origin" to temporarily bypass this while testing.