// public/admin-script.js

const socket = io();

const adminLoginPage = document.getElementById('admin-login-page');
const adminDashboard = document.getElementById('admin-dashboard');
const adminPasswordInput = document.getElementById('admin-password-input');
const adminLoginButton = document.getElementById('admin-login-button');
const adminErrorMessage = document.getElementById('admin-error-message');
const roomListContainer = document.getElementById('room-list');
const roomDetailsContainer = document.getElementById('room-details-container');
const noRoomSelectedMessage = document.getElementById('no-room-selected-message');

const activeRoomsStat = document.getElementById('active-rooms-stat');
const activeUsersStat = document.getElementById('active-users-stat');
const avgSessionDurationStat = document.getElementById('avg-session-duration-stat');

let currentActiveRoom = null;

adminLoginButton.addEventListener('click', () => {
    const password = adminPasswordInput.value;
    socket.emit('admin:login', password);
});

socket.on('admin:authenticated', (data) => {
    adminLoginPage.style.display = 'none';
    adminDashboard.style.display = 'flex';
    updateDashboard(data);
});

socket.on('admin:auth-failed', () => {
    adminErrorMessage.textContent = 'Falsches Admin-Passwort.';
});

socket.on('admin:update-rooms', (data) => {
    updateDashboard(data);
});

function updateDashboard(data) {
    updateStats(data.stats);
    updateRoomList(data.rooms);

    if (currentActiveRoom) {
        const updatedRoom = data.rooms.find(room => room.roomName === currentActiveRoom);
        if (updatedRoom) {
            displayRoomDetails(updatedRoom);
        } else {
            roomDetailsContainer.innerHTML = '';
            roomDetailsContainer.appendChild(noRoomSelectedMessage);
            currentActiveRoom = null;
        }
    }
}

function updateStats(stats) {
    activeRoomsStat.textContent = stats.activeRoomsCount;
    activeUsersStat.textContent = stats.activeUsersCount;
    avgSessionDurationStat.textContent = `${(stats.averageSessionDuration / 60000).toFixed(2)} min`;
}

function updateRoomList(rooms) {
    roomListContainer.innerHTML = '';
    if (rooms.length === 0) {
        const noRooms = document.createElement('div');
        noRooms.classList.add('info-card');
        noRooms.innerHTML = '<p>Aktuell sind keine Räume verfügbar.</p>';
        roomListContainer.appendChild(noRooms);
    } else {
        rooms.forEach(room => {
            const button = document.createElement('button');
            button.textContent = room.roomName;
            button.classList.add('room-item');
            if (room.roomName === currentActiveRoom) {
                button.classList.add('active');
            }
            button.addEventListener('click', () => {
                currentActiveRoom = room.roomName;
                document.querySelectorAll('.room-item').forEach(t => t.classList.remove('active'));
                button.classList.add('active');
                displayRoomDetails(room);
            });
            roomListContainer.appendChild(button);
        });
    }
}

function displayRoomDetails(room) {
    roomDetailsContainer.innerHTML = '';

    const detailsHtml = `
        <div class="details-header">
            <h2>Raum: ${room.roomName}</h2>
            <button class="btn btn-danger btn-small" onclick="deleteRoom('${room.roomName}')">Raum löschen</button>
        </div>

        <div class="details-grid">
            <div class="detail-card">
                <h3>Nutzer (${room.users.length})</h3>
                <div class="detail-card-content">
                    <ul class="user-list">
                        ${room.users.map(user => `
                            <li class="user-item">
                                <div class="user-info">
                                    <b>${user.name} ${user.id === room.owner ? '(Ersteller)' : ''}</b>
                                    <div class="user-details">
                                        IP: ${user.ip || 'Unbekannt'}<br>
                                        Gerät: ${user.device || 'Unbekannt'}<br>
                                        Browser: ${user.browser || 'Unbekannt'}
                                    </div>
                                </div>
                                <div class="user-actions">
                                    ${user.id !== room.owner ? `<button class="btn btn-danger btn-small" onclick="kickUser('${room.roomName}', '${user.id}')">Kicken</button>` : ''}
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>

            <div class="detail-card">
                <h3>Editor-Text</h3>
                <div class="detail-card-content">
                    <pre class="editor-preview">${room.text}</pre>
                </div>
            </div>

            <div class="detail-card">
                <h3>Chat (${room.chatMessages.length})</h3>
                <div class="detail-card-content">
                    <ul class="chat-messages">
                        ${room.chatMessages.map(msg => `
                            <li class="chat-message-item">
                                <div class="chat-message-text"><b>${msg.senderName}:</b> ${msg.text}</div>
                                <button class="btn btn-action" onclick="deleteMessage('${room.roomName}', ${msg.id})">❌</button>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        </div>
    `;

    roomDetailsContainer.innerHTML = detailsHtml;
}

// Global verfügbare Funktionen für die onclick-Events
window.deleteRoom = (roomName) => {
    if (confirm(`Möchtest du den Raum "${roomName}" wirklich löschen?`)) {
        socket.emit('admin:delete-room', roomName);
    }
};

window.deleteMessage = (roomName, messageId) => {
    socket.emit('admin:delete-message', { roomName, messageId });
};

window.kickUser = (roomName, userId) => {
    socket.emit('admin:kick-user', { roomName, userId });
};