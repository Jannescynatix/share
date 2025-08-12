// public/admin-script.js


const socket = io();


const adminLoginPage = document.getElementById('admin-login-page');

const adminDashboard = document.getElementById('admin-dashboard');

const adminPasswordInput = document.getElementById('admin-password-input');

const adminLoginButton = document.getElementById('admin-login-button');

const adminErrorMessage = document.getElementById('admin-error-message');

const roomTabsContainer = document.getElementById('room-tabs');

const roomDetailsContainer = document.getElementById('room-details-container');

const noRoomSelectedMessage = document.getElementById('no-room-selected-message');


const activeRoomsStat = document.getElementById('active-rooms-stat');

const activeUsersStat = document.getElementById('active-users-stat');

const mostPopularRoomStat = document.getElementById('most-popular-room-stat');

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

    mostPopularRoomStat.textContent = stats.mostPopularRoom ? `${stats.mostPopularRoom[0]} (${stats.mostPopularRoom[1]})` : 'N/A';

    avgSessionDurationStat.textContent = `${(stats.averageSessionDuration / 60000).toFixed(2)} min`;

}


function updateRoomList(rooms) {

    roomTabsContainer.innerHTML = '';

    if (rooms.length === 0) {

        const noRooms = document.createElement('p');

        noRooms.textContent = 'Aktuell sind keine Räume verfügbar.';

        roomTabsContainer.appendChild(noRooms);

    } else {

        rooms.forEach(room => {

            const tab = document.createElement('button');

            tab.textContent = room.roomName;

            tab.classList.add('room-tab');

            if (room.roomName === currentActiveRoom) {

                tab.classList.add('active');

            }

            tab.addEventListener('click', () => {

                currentActiveRoom = room.roomName;

                document.querySelectorAll('.room-tab').forEach(t => t.classList.remove('active'));

                tab.classList.add('active');

                displayRoomDetails(room);

            });

            roomTabsContainer.appendChild(tab);

        });

    }

}


function displayRoomDetails(room) {

    roomDetailsContainer.innerHTML = '';


    const roomDetails = document.createElement('div');

    roomDetails.id = 'room-details';


    const header = document.createElement('div');

    header.classList.add('room-details-header');


    const title = document.createElement('h2');

    title.textContent = `Raum: ${room.roomName}`;

    header.appendChild(title);


    const controls = document.createElement('div');


    const deleteButton = document.createElement('button');

    deleteButton.textContent = 'Raum löschen';

    deleteButton.classList.add('btn', 'btn-danger');

    deleteButton.addEventListener('click', () => {

        if (confirm(`Möchtest du den Raum "${room.roomName}" wirklich löschen?`)) {

            socket.emit('admin:delete-room', room.roomName);

        }

    });

    controls.appendChild(deleteButton);

    header.appendChild(controls);

    roomDetails.appendChild(header);


    const info = document.createElement('p');

    info.innerHTML = `<b>Passwort:</b> ${room.password}`;

    roomDetails.appendChild(info);


    const panels = document.createElement('div');

    panels.classList.add('room-details-panels');


// Text-Panel

    const textPanel = document.createElement('div');

    textPanel.classList.add('details-panel');

    textPanel.innerHTML = '<h3>Editor-Text</h3>';

    const editorText = document.createElement('div');

    editorText.classList.add('editor-text');

    editorText.textContent = room.text;

    textPanel.appendChild(editorText);

    panels.appendChild(textPanel);


// Chat-Panel

    const chatPanel = document.createElement('div');

    chatPanel.classList.add('details-panel');

    chatPanel.innerHTML = '<h3>Chat</h3>';

    const chatMessages = document.createElement('ul');

    chatMessages.classList.add('chat-messages');

    room.chatMessages.forEach(msg => {

        const messageItem = document.createElement('li');

        messageItem.innerHTML = `<b>${msg.senderName}:</b> ${msg.text}`;


        const deleteBtn = document.createElement('button');

        deleteBtn.textContent = '❌';

        deleteBtn.classList.add('btn-action');

        deleteBtn.addEventListener('click', () => {

            socket.emit('admin:delete-message', { roomName: room.roomName, messageId: msg.id });

        });

        messageItem.appendChild(deleteBtn);

        chatMessages.appendChild(messageItem);

    });

    chatPanel.appendChild(chatMessages);

    panels.appendChild(chatPanel);


// Nutzer-Panel

    const usersPanel = document.createElement('div');

    usersPanel.classList.add('details-panel');

    usersPanel.innerHTML = '<h3>Nutzer</h3>';

    const userList = document.createElement('ul');

    userList.classList.add('user-list');

    room.users.forEach(user => {

        const userItem = document.createElement('li');

        userItem.innerHTML = `

<div>

<b>Name:</b> ${user.name} ${user.id === room.owner ? '(Ersteller)' : ''}

<div class="user-details">

IP: ${user.ip || 'Unbekannt'}<br>

Gerät: ${user.device || 'Unbekannt'}<br>

Browser: ${user.browser || 'Unbekannt'}

</div>

</div>

`;


        const userActions = document.createElement('div');

        userActions.classList.add('user-actions');


        if (user.id !== room.owner) {

            const kickBtn = document.createElement('button');

            kickBtn.textContent = 'Kicken';

            kickBtn.classList.add('btn', 'btn-danger', 'btn-small');

            kickBtn.addEventListener('click', () => {

                socket.emit('admin:kick-user', { roomName: room.roomName, userId: user.id });

            });

            userActions.appendChild(kickBtn);

        }


        userItem.appendChild(userActions);

        userList.appendChild(userItem);

    });

    usersPanel.appendChild(userList);

    panels.appendChild(usersPanel);


    roomDetails.appendChild(panels);

    roomDetailsContainer.appendChild(roomDetails);

}