// public/script.js

const socket = io();
let currentRoom = '';
let currentUsername = '';
let isOwner = false;
let mySocketId = '';

const loginPage = document.getElementById('login-page');
const mainApp = document.getElementById('main-app');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const passwordInput = document.getElementById('password-input');
const joinButton = document.getElementById('join-button');
const errorMessage = document.getElementById('error-message');
const roomTitle = document.getElementById('room-title');
const roomPasswordDisplay = document.getElementById('room-password-display');
const changePasswordBtn = document.getElementById('change-password-btn');
const shareLinkBtn = document.getElementById('share-link-btn');
const textEditor = document.getElementById('text-editor');
const downloadButton = document.getElementById('download-button');
const leaveButton = document.getElementById('leave-button');
const deleteButton = document.getElementById('delete-button');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const userList = document.getElementById('user-list');
const bannedUserList = document.getElementById('banned-user-list');
const bannedUsersHeader = document.getElementById('banned-users-header');

function joinRoom(roomName, password, username) {
    socket.emit('join room', { roomName, password, username });
    currentRoom = roomName;
    currentUsername = username;
}

const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
const passwordFromUrl = urlParams.get('password');
if (roomFromUrl) {
    roomInput.value = roomFromUrl;
    if (passwordFromUrl) {
        passwordInput.value = passwordFromUrl;
    }
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
    mySocketId = data.socketId;

    isOwner = (data.room.owner === mySocketId);
    if (isOwner) {
        deleteButton.style.display = 'inline-block';
        changePasswordBtn.style.display = 'inline-block';
    } else {
        deleteButton.style.display = 'none';
        changePasswordBtn.style.display = 'none';
    }

    roomTitle.textContent = `Raum: ${currentRoom}`;
    roomPasswordDisplay.textContent = `Passwort: ${data.room.password}`;

    window.history.pushState(null, '', `?room=${currentRoom}`);
});

socket.on('login failed', (message) => {
    errorMessage.textContent = message;
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

function createMessageElement(messageData) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    messageElement.dataset.messageId = messageData.id;

    const messageContent = document.createElement('div');
    messageContent.classList.add('chat-message-content');

    const senderText = document.createElement('span');
    senderText.innerHTML = `<span class="chat-message-sender">${messageData.senderName}:</span> ${messageData.text}`;
    messageContent.appendChild(senderText);

    messageElement.appendChild(messageContent);

    if (isOwner || messageData.senderId === mySocketId) {
        const deleteButton = document.createElement('button');
        deleteButton.textContent = '❌';
        deleteButton.classList.add('btn-action');
        deleteButton.title = 'Nachricht löschen';
        deleteButton.addEventListener('click', () => {
            socket.emit('delete message', { roomName: currentRoom, messageId: messageData.id });
        });
        messageElement.appendChild(deleteButton);
    }
    return messageElement;
}

sendButton.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat message', { roomName: currentRoom, message });
        chatInput.value = '';
    }
});

chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click();
    }
});

socket.on('load messages', (messages) => {
    chatMessages.innerHTML = '';
    messages.forEach(msg => {
        chatMessages.appendChild(createMessageElement(msg));
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('new message', (messageData) => {
    chatMessages.appendChild(createMessageElement(messageData));
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('message deleted', (messageId) => {
    const messageElement = document.querySelector(`.chat-message[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.remove();
    }
});

socket.on('update room data', (roomData) => {
    userList.innerHTML = '';
    bannedUserList.innerHTML = '';
    roomPasswordDisplay.textContent = `Passwort: ${roomData.password}`;

    roomData.users.forEach(user => {
        const userItem = document.createElement('li');
        userItem.classList.add('user-item');

        const userNameSpan = document.createElement('span');
        userNameSpan.classList.add('user-name');
        userNameSpan.textContent = user.name;
        userItem.appendChild(userNameSpan);

        if (roomData.owner === user.id) {
            const ownerTag = document.createElement('span');
            ownerTag.classList.add('owner-tag');
            ownerTag.textContent = 'Ersteller';
            userItem.appendChild(ownerTag);
        }

        if (isOwner && user.id !== mySocketId) {
            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('user-actions');

            const kickButton = document.createElement('button');
            kickButton.textContent = 'Rauswerfen';
            kickButton.classList.add('btn', 'btn-danger', 'btn-small');
            kickButton.addEventListener('click', () => {
                socket.emit('kick user', { roomName: currentRoom, userId: user.id });
            });
            buttonContainer.appendChild(kickButton);

            const banButton = document.createElement('button');
            banButton.textContent = 'Bannen';
            banButton.classList.add('btn', 'btn-secondary', 'btn-small');
            banButton.addEventListener('click', () => {
                socket.emit('ban user', { roomName: currentRoom, userId: user.id });
            });
            buttonContainer.appendChild(banButton);

            userItem.appendChild(buttonContainer);
        }
        userList.appendChild(userItem);
    });

    if (isOwner && roomData.bannedUsers && roomData.bannedUsers.length > 0) {
        bannedUsersHeader.style.display = 'block';
        roomData.bannedUsers.forEach(bannedName => {
            const bannedItem = document.createElement('li');
            bannedItem.classList.add('user-item', 'banned-user');

            const bannedNameSpan = document.createElement('span');
            bannedNameSpan.classList.add('user-name');
            bannedNameSpan.textContent = `${bannedName} (gebannt)`;
            bannedItem.appendChild(bannedNameSpan);

            const unbanButton = document.createElement('button');
            unbanButton.textContent = 'Zulassen';
            unbanButton.classList.add('btn', 'btn-success', 'btn-small');
            unbanButton.addEventListener('click', () => {
                socket.emit('unban user', { roomName: currentRoom, username: bannedName });
            });
            bannedItem.appendChild(unbanButton);
            bannedUserList.appendChild(bannedItem);
        });
    } else {
        bannedUsersHeader.style.display = 'none';
    }
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

changePasswordBtn.addEventListener('click', () => {
    const newPassword = prompt('Gib das neue Passwort ein:');
    if (newPassword && newPassword.trim() !== '') {
        socket.emit('change password', { roomName: currentRoom, newPassword });
    }
});

shareLinkBtn.addEventListener('click', () => {
    const url = `${window.location.origin}/?room=${currentRoom}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('Der Raumnamen-Link wurde in die Zwischenablage kopiert. Teile den Link und das Passwort mit anderen!');
    });
});

socket.on('room deleted', (message) => {
    alert(message);
    window.location.reload();
});

socket.on('kicked', (message) => {
    alert(message);
    window.location.reload();
});