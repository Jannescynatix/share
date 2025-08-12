// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const useragent = require('user-agent');
const bcrypt = require('bcrypt');
const session = require('express-session');
const sharedsession = require('express-socket.io-session');

const app = express();
const server = http.createServer(app);
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'EinGeheimesSchluesselWort',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: 'auto' }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const io = socketIo(server);
io.use(sharedsession(sessionMiddleware, {
    autoSave: true
}));

const rooms = {};
const sessionStarts = {};

// WICHTIG: Das Admin-Passwort muss gehasht und NICHT im Klartext gespeichert werden.
// Führen Sie diesen Befehl einmalig aus, um einen Hash zu generieren:
// bcrypt.hash('ihrSicheresAdminPasswort', 10, (err, hash) => console.log(hash));
// Kopieren Sie den generierten Hash hierher oder in eine Umgebungsvariable.
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '$2b$10$oY75i7z6c6O3M7P6Q7R8O.G/N2Z.J1j.j6A.j1j.j6A.';

// Admin-Seite bedienen
app.get('/admin', (req, res) => {
    if (req.session.isAdmin) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
    }
});

// Admin-Login-Endpoint
app.post('/admin-login', (req, res) => {
    const { password } = req.body;
    bcrypt.compare(password, ADMIN_PASSWORD_HASH, (err, result) => {
        if (result === true) {
            req.session.isAdmin = true;
            req.session.save();
            res.status(200).send({ success: true, message: 'Login erfolgreich.' });
        } else {
            res.status(401).send({ success: false, message: 'Falsches Passwort.' });
        }
    });
});

function decrypt(text, key) {
    if (!text || !key) return null;
    try {
        const decipher = crypto.createDecipher('aes-256-cbc', key);
        let dec = decipher.update(text, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (e) {
        console.error("Fehler beim Entschlüsseln des Passworts:", e);
        return null;
    }
}

function getStats() {
    const activeRoomsCount = Object.keys(rooms).length;
    let activeUsersCount = 0;
    const roomNames = {};
    const sessionDurations = [];

    for (const roomName in rooms) {
        activeUsersCount += rooms[roomName].users.length;
        if (roomNames[roomName]) {
            roomNames[roomName]++;
        } else {
            roomNames[roomName] = 1;
        }
    }

    for (const roomId in sessionStarts) {
        sessionDurations.push(Date.now() - sessionStarts[roomId]);
    }

    const avgSessionDuration = sessionDurations.length > 0
        ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
        : 0;

    return {
        activeRoomsCount,
        activeUsersCount,
        mostPopularRoom: Object.entries(roomNames).sort(([, a], [, b]) => b - a)[0],
        averageSessionDuration: avgSessionDuration
    };
}

io.on('connection', (socket) => {
    const userAgentHeader = socket.handshake.headers['user-agent'] || '';
    const clientInfo = useragent.parse(userAgentHeader);

    sessionStarts[socket.id] = Date.now();

    // --- Admin-Events ---
    socket.on('admin:check-session', () => {
        if (socket.handshake.session && socket.handshake.session.isAdmin) {
            socket.join('admin-room');
            socket.emit('admin:authenticated', { rooms: Object.values(rooms), stats: getStats() });
            console.log(`Admin ${socket.id} hat sich über Session angemeldet.`);
        } else {
            socket.emit('admin:auth-failed');
        }
    });

    socket.on('admin:kick-user', ({ roomName, userId }) => {
        if (!socket.handshake.session.isAdmin) return;
        if (!rooms[roomName]) return;

        const userToKick = rooms[roomName].users.find(u => u.id === userId);
        if (userToKick) {
            const clientSocket = io.sockets.sockets.get(userId);
            if (clientSocket) {
                clientSocket.leave(roomName);
                clientSocket.emit('kicked', 'Du wurdest vom Admin aus dem Raum geworfen.');
            }
            rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== userId);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { senderName: 'System (Admin)', text: `${userToKick.name} wurde aus dem Raum geworfen.` });
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('admin:delete-room', (roomName) => {
        if (!socket.handshake.session.isAdmin) return;
        if (rooms[roomName]) {
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Admin gelöscht.');
            delete rooms[roomName];
            console.log(`Raum '${roomName}' wurde vom Admin gelöscht.`);
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('admin:delete-message', ({ roomName, messageId }) => {
        if (!socket.handshake.session.isAdmin) return;
        if (rooms[roomName]) {
            rooms[roomName].chatMessages = rooms[roomName].chatMessages.filter(m => m.id !== messageId);
            io.to(roomName).emit('message deleted', messageId);
            io.to(roomName).emit('chat message', { senderName: 'System (Admin)', text: `Eine Nachricht wurde gelöscht.` });
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    // --- Haupt-App Events ---
    socket.on('join room', ({ roomName, password, username }) => {
        let decryptedPassword = password;
        if (password && process.env.ENCRYPTION_KEY) {
            decryptedPassword = decrypt(password, process.env.ENCRYPTION_KEY);
            if (!decryptedPassword) {
                socket.emit('login failed', 'Fehler beim Passwort.');
                return;
            }
        }

        if (rooms[roomName] && rooms[roomName].bannedUsers && rooms[roomName].bannedUsers.includes(username)) {
            socket.emit('login failed', 'Du wurdest dauerhaft aus diesem Raum gebannt.');
            return;
        }

        const newUserData = {
            id: socket.id,
            name: username,
            ip: socket.handshake.address || 'Unbekannt',
            device: clientInfo.device && clientInfo.device.family ? clientInfo.device.family : 'Unbekannt',
            browser: clientInfo.browser && clientInfo.browser.name ? clientInfo.browser.name : 'Unbekannt'
        };

        if (!rooms[roomName]) {
            rooms[roomName] = {
                roomName,
                text: '',
                password: decryptedPassword,
                owner: socket.id,
                users: [newUserData],
                bannedUsers: [],
                chatMessages: []
            };
            console.log(`Neuer Raum '${roomName}' erstellt von ${username}.`);
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName], socketId: socket.id, username: username });
        } else if (rooms[roomName].password === decryptedPassword) {
            if (!rooms[roomName].users.find(u => u.name === username)) {
                rooms[roomName].users.push(newUserData);
            }
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName], socketId: socket.id, username: username });
            console.log(`Benutzer '${username}' ist Raum '${roomName}' beigetreten.`);
        } else {
            socket.emit('login failed', 'Falsches Passwort.');
            return;
        }

        io.to(roomName).emit('update text', rooms[roomName].text);
        io.to(roomName).emit('update room data', rooms[roomName]);
        io.to(roomName).emit('load messages', rooms[roomName].chatMessages);
        io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
    });

    socket.on('text changed', ({ roomName, newText }) => {
        if (rooms[roomName]) {
            rooms[roomName].text = newText;
            socket.to(roomName).emit('update text', newText);
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('chat message', ({ roomName, message }) => {
        if (rooms[roomName]) {
            const user = rooms[roomName].users.find(u => u.id === socket.id);
            if (user) {
                const messageData = {
                    id: Date.now(),
                    senderId: socket.id,
                    senderName: user.name,
                    text: message
                };
                rooms[roomName].chatMessages.push(messageData);
                io.to(roomName).emit('new message', messageData);
                io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
            }
        }
    });

    socket.on('delete message', ({ roomName, messageId }) => {
        if (rooms[roomName]) {
            const messageIndex = rooms[roomName].chatMessages.findIndex(m => m.id === messageId);
            if (messageIndex > -1) {
                const messageToDelete = rooms[roomName].chatMessages[messageIndex];
                if (rooms[roomName].owner === socket.id || messageToDelete.senderId === socket.id) {
                    rooms[roomName].chatMessages.splice(messageIndex, 1);
                    io.to(roomName).emit('message deleted', messageId);
                    io.to(roomName).emit('chat message', { senderName: 'System', text: `Eine Nachricht wurde gelöscht.` });
                    io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
                }
            }
        }
    });

    socket.on('change password', ({ roomName, newPassword }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].password = newPassword;
            io.to(roomName).emit('chat message', { senderName: 'System', text: `Das Passwort wurde zu "${newPassword}" geändert.` });
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('kick user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            const userToKick = rooms[roomName].users.find(u => u.id === userId);
            if (userToKick && userToKick.id !== rooms[roomName].owner) {
                const clientSocket = io.sockets.sockets.get(userId);
                if (clientSocket) {
                    clientSocket.leave(roomName);
                    clientSocket.emit('kicked', 'Du wurdest aus dem Raum geworfen.');
                }
                rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== userId);
                io.to(roomName).emit('update room data', rooms[roomName]);
                io.to(roomName).emit('chat message', { senderName: 'System', text: `${userToKick.name} wurde aus dem Raum geworfen.` });
                io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
            }
        }
    });

    socket.on('ban user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            const userToBan = rooms[roomName].users.find(u => u.id === userId);
            if (userToBan && userToBan.id !== rooms[roomName].owner) {
                rooms[roomName].bannedUsers.push(userToBan.name);
                const clientSocket = io.sockets.sockets.get(userId);
                if (clientSocket) {
                    clientSocket.leave(roomName);
                    clientSocket.emit('kicked', 'Du wurdest dauerhaft aus diesem Raum gebannt.');
                }
                rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== userId);
                io.to(roomName).emit('update room data', rooms[roomName]);
                io.to(roomName).emit('chat message', { senderName: 'System', text: `${userToBan.name} wurde dauerhaft gebannt.` });
                io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
            }
        }
    });

    socket.on('unban user', ({ roomName, username }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].bannedUsers = rooms[roomName].bannedUsers.filter(name => name !== username);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { senderName: 'System', text: `Benutzer "${username}" wurde entbannt.` });
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('delete room', ({ roomName }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Ersteller gelöscht.');
            delete rooms[roomName];
            console.log(`Raum '${roomName}' wurde gelöscht.`);
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('leave room', ({ roomName }) => {
        if (rooms[roomName]) {
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            socket.leave(roomName);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { senderName: 'System', text: `Jemand hat den Raum verlassen.` });
            io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Ein Benutzer hat die Verbindung getrennt: ${socket.id}`);
        delete sessionStarts[socket.id];
        for (const roomName in rooms) {
            const initialUserCount = rooms[roomName].users.length;
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            if (rooms[roomName].users.length < initialUserCount) {
                io.to(roomName).emit('update room data', rooms[roomName]);
                io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
                if (rooms[roomName].users.length === 0) {
                    delete rooms[roomName];
                    console.log(`Raum '${roomName}' wurde gelöscht, da keine Benutzer mehr da sind.`);
                    io.to('admin-room').emit('admin:update-rooms', { rooms: Object.values(rooms), stats: getStats() });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});