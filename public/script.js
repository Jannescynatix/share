// public/script.js

const socket = io();
let currentRoom = '';

const loginPage = document.getElementById('login-page');
const editorPage = document.getElementById('editor-page');
const roomInput = document.getElementById('room-input');
const passwordInput = document.getElementById('password-input');
const joinButton = document.getElementById('join-button');
const errorMessage = document.getElementById('error-message');
const roomTitle = document.getElementById('room-title');
const textEditor = document.getElementById('text-editor');
const downloadButton = document.getElementById('download-button');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');

// Funktion, um einem Raum beizutreten
function joinRoom(roomName, password) {
    socket.emit('join room', { roomName, password });
    currentRoom = roomName;
}

// Prüfe die URL auf einen Raumnamen
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
    roomInput.value = roomFromUrl;
}

joinButton.addEventListener('click', () => {
    const roomName = roomInput.value.trim();
    const password = passwordInput.value;
    if (roomName && password) {
        joinRoom(roomName, password);
    } else {
        errorMessage.textContent = 'Raumname und Passwort dürfen nicht leer sein.';
    }
});

socket.on('login successful', () => {
    loginPage.style.display = 'none';
    editorPage.style.display = 'flex';
    roomTitle.textContent = `Raum: ${currentRoom}`;

    // URL aktualisieren, um den Raumnamen anzuzeigen
    window.history.pushState(null, '', `?room=${currentRoom}`);
});

socket.on('login failed', () => {
    errorMessage.textContent = 'Falsches Passwort. Bitte versuche es erneut.';
});

socket.on('update text', (newText) => {
    const cursorPosition = textEditor.selectionStart;
    textEditor.value = newText;
    textEditor.selectionStart = cursorPosition;
    textEditor.selectionEnd = cursorPosition;
});

textEditor.addEventListener('input', (event) => {
    socket.emit('text changed', { roomName: currentRoom, newText: event.target.value });
});

downloadButton.addEventListener('click', () => {
    const text = textEditor.value;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentRoom}_live_text_editor.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Chat-Logik
sendButton.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat message', { roomName: currentRoom, message });
        chatInput.value = '';
    }
});

socket.on('chat message', (message) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-Scroll
});