// public/script.js

const socket = io();
let currentRoom = '';
let currentUsername = '';
let isOwner = false;

// DOM-Elemente
const loginPage = document.getElementById('login-page');
const mainApp = document.getElementById('main-app');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const passwordInput = document.getElementById('password-input');
const joinButton = document.getElementById('join-button');
const errorMessage = document.getElementById('error-message');
const roomTitle = document.getElementById('room-title');
const roomPasswordDisplay = document.getElementById('room-password-display');
const textEditor = document.getElementById('text-editor');
const downloadButton = document.getElementById('download-button');
const leaveButton = document.getElementById('leave-button');
const deleteButton = document.getElementById('delete-button');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const userList = document.getElementById('user-list');

// Funktion, um einem Raum beizutreten
function joinRoom(roomName, password, username) {
    socket.emit('join room', { roomName, password, username });
    currentRoom = roomName;
    currentUsername = username;
}

// Prüfe die URL auf einen Raumnamen
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
    roomInput.value = roomFromUrl;
}

joinButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomName = roomInput.value.trim();
    const password = passwordInput.value;
    if (username && roomName && password) {
        joinRoom(roomName, password, username);
    } else {
        errorMessage.textContent = 'Alle Felder müssen ausgefüllt sein.';
    }
});

socket.on('login successful', (data) => {
    loginPage.style.display = 'none';
    mainApp.style.display = 'flex';
    roomTitle.textContent = `Raum: ${currentRoom}`;
    roomPasswordDisplay.textContent = `Passwort: ${data.room.password}`;

    // Prüfe, ob der aktuelle Nutzer der Raumbesitzer ist
    if (data.room.owner === socket.id) {
        isOwner = true;
        deleteButton.style.display = 'inline-block';
    } else {
        isOwner = false;
        deleteButton.style.display = 'none';
    }

    // URL aktualisieren, um den Raumnamen anzuzeigen
    window.history.pushState(null, '', `?room=${currentRoom}`);
});

socket.on('login failed', (message) => {
    errorMessage.textContent = message;
});

// Texteditor-Logik
socket.on('update text', (newText) => {
    const cursorPosition = textEditor.selectionStart;
    textEditor.value = newText;
    textEditor.selectionStart = cursorPosition;
    textEditor.selectionEnd = cursorPosition;
});

textEditor.addEventListener('input', (event) => {
    socket.emit('text changed', { roomName: currentRoom, newText: event.target.value });
});

// Chat-Logik
sendButton.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat message', { roomName: currentRoom, message });
        chatInput.value = '';
    }
});

socket.on('chat message', (data) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    const senderSpan = document.createElement('span');
    senderSpan.classList.add('sender');
    senderSpan.textContent = `${data.sender}: `;
    messageElement.appendChild(senderSpan);
    messageElement.appendChild(document.createTextNode(data.text));
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-Scroll
});

// Nutzerliste-Logik
socket.on('update users', (users) => {
    userList.innerHTML = '';
    users.forEach(user => {
        const userItem = document.createElement('li');
        userItem.classList.add('user-item');
        userItem.textContent = user.name;

        if (isOwner && user.id !== socket.id) {
            const kickButton = document.createElement('button');
            kickButton.textContent = 'Rauswerfen';
            kickButton.classList.add('btn', 'btn-danger');
            kickButton.addEventListener('click', () => {
                socket.emit('kick user', { roomName: currentRoom, userId: user.id });
            });
            userItem.appendChild(kickButton);
        }
        userList.appendChild(userItem);
    });
});

// Button-Funktionen
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

leaveButton.addEventListener('click', () => {
    socket.emit('leave room', { roomName: currentRoom });
    window.location.reload();
});

deleteButton.addEventListener('click', () => {
    if (isOwner && confirm('Möchtest du den Raum wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
        socket.emit('delete room', { roomName: currentRoom });
        window.location.reload();
    }
});

socket.on('room deleted', (message) => {
    alert(message);
    window.location.reload();
});

socket.on('kicked', (message) => {
    alert(message);
    window.location.reload();
});