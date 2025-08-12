// public/script.js

const socket = io();

const loginContainer = document.getElementById('login-container');
const editorContainer = document.getElementById('editor-container');
const passwordInput = document.getElementById('password-input');
const loginButton = document.getElementById('login-button');
const errorMessage = document.getElementById('error-message');
const textEditor = document.getElementById('text-editor');
const downloadButton = document.getElementById('download-button');

loginButton.addEventListener('click', () => {
    const passwordAttempt = passwordInput.value;
    socket.emit('login attempt', passwordAttempt);
});

socket.on('login successful', () => {
    loginContainer.style.display = 'none';
    editorContainer.style.display = 'block';
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
    const newText = event.target.value;
    socket.emit('text changed', newText);
});

downloadButton.addEventListener('click', () => {
    const text = textEditor.value;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'live_text_editor.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});