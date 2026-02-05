RAGFlow Lore Injector for SillyTavern
=====================================

This extension connects your SillyTavern chat to a RAGFlow Knowledge Base. It queries RAGFlow for relevant context from your books/documents and injects them into the prompt for more accurate roleplay sessions.

## Features

### 🎯 Three Operation Modes

1. **Auto Mode** - Automatically fetches and injects relevant context on every message
2. **Manual Mode** - Only fetches context when you trigger it manually
3. **Disabled** - Completely off for chats that don't need RAG

### 🔧 Per-Chat Configuration

Each chat can have its own mode setting:
- Use the global setting (default)
- Override to Disabled, Auto, or Manual per chat
- Settings persist when switching between chats

### 🎨 Visual Feedback

- Mode indicator shows current status (🔴 OFF / 🟢 AUTO / 🟡 MANUAL)
- Toast notifications for all operations
- Optional preview dialog before injecting context
- Debug mode for troubleshooting

### ⚡ Smart Features

- Context caching to minimize API calls
- Configurable similarity threshold
- Reranking support for better results
- Knowledge graph integration
- Keyword matching option
- Timeout protection

## Installation

1. Create a folder named `ragflow-lore` inside your SillyTavern installation:
   ```
   /public/scripts/extensions/ragflow-lore/
   ```

2. Place these files into that folder:
   - `index.js`
   - `manifest.json`
   - `style.css`

3. Refresh SillyTavern

## Configuration

### Basic Setup

1. Open the Extensions menu (puzzle piece icon)
2. Find "RAGFlow Lore Injector" and click the settings (gear) icon
3. Enable the extension
4. Enter your RAGFlow details:
   - **Base URL**: Your RAGFlow server URL (e.g., `https://rag.latour.live` or `http://localhost:9380`)
   - **API Key**: Get this from your RAGFlow console
   - **Dataset ID**: The ID of the knowledge base to query

### Mode Selection

Choose the global default mode:
- **Auto**: Best for continuous roleplay with consistent context
- **Manual**: Best when you want control over when context is added
- **Disabled**: Best for chats that don't need RAG

### Advanced Settings

- **Max Chunks**: Number of text chunks to retrieve (1-10)
- **Similarity Threshold**: Minimum similarity score (0.0-1.0)
- **Use Knowledge Graph**: Enable KG-based retrieval
- **Keyword Matching**: Add keyword-based search
- **Rerank Model ID**: ID of reranking model (optional)
- **Timeout (ms)**: Request timeout in milliseconds
- **Debug Mode**: Enable verbose logging for troubleshooting
- **Show Preview**: Display context before injecting (Manual mode)
- **Keep in History**: Keep RAG messages in chat after generation

## Usage

### Auto Mode

1. Set mode to "Auto" (global or per-chat)
2. Send messages normally
3. Extension automatically fetches and injects relevant context
4. Context is cleaned up after generation (unless "Keep in History" is enabled)

### Manual Mode

1. Set mode to "Manual" (global or per-chat)
2. Click the "Manual Trigger" button in settings
3. Review the fetched context in the preview dialog
4. Click "Inject Context" to add it to the chat
5. Send your message to use the injected context

### Per-Chat Configuration

1. Look for the RAGFlow controls above the chat input
2. Use the dropdown to select the mode for this specific chat
3. Choose "Use Global Setting" to revert to the default

## Troubleshooting

### CORS Errors

If you see "Network Error" or CORS issues in the browser console (F12):

**Problem**: RAGFlow is rejecting requests from SillyTavern due to CORS policy.

**Solutions**:
1. Configure RAGFlow (Nginx) to allow CORS from your SillyTavern URL
2. Run SillyTavern and RAGFlow behind the same reverse proxy
3. Use a browser extension like "Allow CORS: Access-Control-Allow-Origin" (dev only)

### No Context Being Injected

1. Enable **Debug Mode** in settings
2. Open browser console (F12) and check for error messages
3. Verify your API Key and Dataset ID are correct
4. Try lowering the **Similarity Threshold**
5. Check that the mode is set to "Auto" (not "Disabled")
6. Use the **Test Connection** button to verify API access

### Context Not Appearing in Prompts

1. Check the console logs for injection messages
2. Verify the interceptor is running (look for "INTERCEPTOR_START" in debug logs)
3. Make sure the extension is enabled
4. Try disabling "Keep in History" to see if cleanup is interfering

### Performance Issues

1. Reduce **Max Chunks** to retrieve less data
2. Increase **Similarity Threshold** for more selective results
3. Enable **Debug Mode** to check response times
4. Consider using **Manual Mode** for selective context injection

## Tips for Best Results

1. **Start with Auto Mode** for continuous roleplay sessions
2. **Use Manual Mode** when you need specific context for important scenes
3. **Adjust Similarity Threshold** based on your dataset (start with 0.1-0.2)
4. **Enable Debug Mode** initially to understand what's happening
5. **Use Preview** in Manual Mode to avoid injecting irrelevant context
6. **Keep Chunks Low** (3-5) to avoid overwhelming the LLM
7. **Test Connection** after changing any settings

## Technical Details

### How It Works

1. Before each message generation, the interceptor is triggered
2. The last user message is used as a query
3. RAGFlow API is called with the query and settings
4. Retrieved chunks are formatted and injected as a system message
5. The LLM generates a response with the enhanced context
6. RAG messages are cleaned up (optional)

### Message Structure

Injected messages have this structure:
```javascript
{
    is_user: false,
    is_system: true,
    name: "RAGFlow",
    mes: "<ragflow_context>\n[Your context here]\n</ragflow_context>",
    extra: {
        type: 'ragflow_injection',
        created: timestamp,
        injection_id: unique_id
    }
}
```

### Caching

Queries are cached to avoid duplicate API calls:
- Same query within a session uses cached results
- Cache is cleared when settings change
- Manual triggers bypass cache

## Version History

### v2.0.0 (Current)
- Added per-chat mode configuration
- Added manual trigger with preview
- Added debug mode
- Added visual mode indicator
- Improved error handling and logging
- Added "Keep in History" option
- Fixed injection issues

### v1.0.2
- Initial release with auto mode
- Basic RAGFlow integration
- Settings UI
- Test connection button

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Enable Debug Mode and check console logs
3. Verify your RAGFlow instance is accessible
4. Test your API key and dataset ID in RAGFlow console

## License

This extension is provided as-is for use with SillyTavern and RAGFlow.
