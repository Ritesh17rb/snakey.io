# 🐍 snakey.io

**snakey.io** is a modern, real-time collaborative code editor. Share code instantly with a simple link - no sign-up required.

## ✨ Features

- **🔗 Instant Collaboration** - Share a link and start collaborating immediately
- **⚡ Real-time Sync** - See changes as they happen with conflict-free editing
- **🎨 Beautiful Design** - Modern, sleek interface with dark/light mode support
- **👥 Live Cursors** - See exactly where your collaborators are typing
- **📱 Responsive** - Works seamlessly on desktop and mobile devices
- **🔒 Private Sessions** - Each session gets a unique ID
- **💾 Auto-save** - Your work is automatically saved locally
- **📥 Import/Export** - Upload and download files easily

## 🚀 Quick Start

1. **Clone or download this repository**

2. **Serve the files using a local web server**

   Using Python:
   ```bash
   python -m http.server 8000
   ```

   Using Node.js:
   ```bash
   npx serve
   ```

   Using VS Code Live Server:
   - Right-click on `index.html` → "Open with Live Server"

3. **Open in browser**
   ```
   http://localhost:8000
   ```

## 📖 How to Use

### Starting a New Session

1. Open snakey.io in your browser
2. Enter your name when prompted
3. Start typing!
4. A unique session ID is automatically generated (e.g., `#A3F9K2`)

### Inviting Collaborators

1. Click the **Share** button in the top navigation
2. The session link is copied to your clipboard
3. Send the link to anyone you want to collaborate with
4. They'll join the same session instantly

### Session URLs

Sessions are identified by the hash in the URL:
- `https://snakey.io/#A3F9K2` - Session A3F9K2
- Each session is completely isolated
- Session data is stored locally and synced via WebRTC

## 🏗️ Architecture

### Technology Stack

- **Yjs** - Conflict-free replicated data types (CRDT) for real-time collaboration
- **Quill** - Rich text editor with collaborative editing support
- **WebRTC** - Peer-to-peer data synchronization
- **IndexedDB** - Local persistence
- **Bootstrap 5** - Modern UI framework
- **Vanilla JavaScript** - No heavy frameworks, just ES6 modules

### How It Works

```
User A types "Hello"
    ↓
Yjs creates operation
    ↓
WebRTC broadcasts to peers
    ↓
User B receives operation
    ↓
Yjs merges conflict-free
    ↓
Both see "Hello" instantly
```

### Key Features

#### Conflict-Free Editing
Uses CRDTs (Conflict-free Replicated Data Types) to ensure that multiple users can edit simultaneously without conflicts. No "last write wins" - all edits are preserved.

#### Peer-to-Peer Sync
Data is synchronized directly between browsers using WebRTC. No central server stores your documents - they live in the connected browsers and local storage.

#### Local Persistence
Documents are automatically saved to IndexedDB in your browser. When you return to a session, your work is still there.

## 🎯 Use Cases

- **Pair Programming** - Code together in real-time
- **Code Reviews** - Collaboratively review and edit code
- **Teaching** - Share code examples with students
- **Interviews** - Conduct technical interviews
- **Quick Sharing** - Share code snippets without email
- **Remote Collaboration** - Work with distributed teams

## 🎨 Customization

### Changing Colors

Edit the CSS variables in `styles.css`:

```css
:root {
  --brand-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --accent-color: #667eea;
  /* ... more colors */
}
```

### Adding More Toolbar Options

Modify the toolbar configuration in `script.js`:

```javascript
toolbar: [
  ['bold', 'italic', 'underline', 'strike'],
  // Add more options here
]
```

### Custom Signaling Server

Change the WebRTC signaling server in `script.js`:

```javascript
provider = new WebrtcProvider(sessionId, ydoc, {
  signaling: ['wss://your-signaling-server.com']
});
```

## 🔧 Advanced

### Running Your Own Signaling Server

For production use, you may want to run your own signaling server:

```bash
git clone https://github.com/yjs/y-webrtc
cd y-webrtc
npm install
npm start
```

Then update the signaling URL in `script.js`.

### Deploying to Production

This is a static site and can be deployed to:
- GitHub Pages
- Netlify
- Vercel
- Any static hosting service

Just upload the files and you're done!

## 🐛 Troubleshooting

### Connection Issues

**Problem**: "Connecting..." status doesn't change to "Connected"

**Solutions**:
1. Check if WebRTC is blocked by your firewall
2. Try a different browser
3. Check browser console for errors

### Users Not Seeing Each Other

**Problem**: Multiple users in same session but can't see each other

**Solutions**:
1. Ensure both users have the exact same URL (including hash)
2. Refresh both browsers
3. Check network connectivity

### Data Not Persisting

**Problem**: Document content disappears on refresh

**Solutions**:
1. Check if IndexedDB is enabled in your browser
2. Clear browser cache and try again
3. Check browser console for storage errors

## 📱 Browser Support

- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari
- ⚠️ Mobile browsers (limited support)

## 🔒 Privacy & Security

- **No Server Storage** - Documents are never stored on a central server
- **Peer-to-Peer** - Data is transmitted directly between browsers
- **Local First** - Everything is saved locally in your browser
- **Session Isolation** - Each session is completely separate
- **No Tracking** - We don't track or collect any user data

## 📄 License

MIT License - feel free to use this code for your own projects!

## 🙏 Acknowledgments

- **Yjs** - Amazing CRDT implementation
- **Quill** - Excellent rich text editor
- **Bootstrap** - Beautiful UI components

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

---

**Built with ❤️ for seamless collaboration**

Visit us at [snakey.io](https://snakey.io)