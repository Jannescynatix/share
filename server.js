// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const rooms = {};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Statische Dateien aus dem 'public' Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Admin-Seite bedienen
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin-Login-Endpoint
app.post('/admin-login', express.json(), (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.status(200).send({ success: true, message: 'Login erfolgreich.' });
    } else {
        res.status(401).send({ success: false, message: 'Falsches Passwort.' });
    }
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

io.on('connection', (socket) => {
    console.log(`Ein Benutzer hat sich verbunden: ${socket.id}`);

    // Admin-spezifische Events
    socket.on('admin:login', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.join('admin-room');
            socket.emit('admin:authenticated', Object.values(rooms));
            console.log(`Admin ${socket.id} hat sich angemeldet.`);
        } else {
            socket.emit('admin:auth-failed');
        }
    });

    socket.on('admin:kick-user', ({ roomName, userId }) => {
        if (!socket.rooms.has('admin-room')) return;
        if (rooms[roomName]) {
            const userToKick = rooms[roomName].users.find(u => u.id === userId);
            if (userToKick) {
                const clientSocket = io.sockets.sockets.get(userId);
                if (clientSocket) {
                    clientSocket.leave(roomName);
                    clientSocket.emit('kicked', 'Du wurdest vom Admin aus dem Raum geworfen.');
                }
                rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== userId);
                io.to(roomName).emit('update room data', rooms[roomName]);
                io.to(roomName).emit('chat message', { sender: 'System (Admin)', text: `${userToKick.name} wurde aus dem Raum geworfen.` });
                io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
            }
        }
    });

    socket.on('admin:delete-room', (roomName) => {
        if (!socket.rooms.has('admin-room')) return;
        if (rooms[roomName]) {
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Admin gelöscht.');
            delete rooms[roomName];
            console.log(`Raum '${roomName}' wurde vom Admin gelöscht.`);
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
        }
    });

    socket.on('admin:delete-message', ({ roomName, messageId }) => {
        if (!socket.rooms.has('admin-room')) return;
        if (rooms[roomName]) {
            rooms[roomName].chatMessages = rooms[roomName].chatMessages.filter(m => m.id !== messageId);
            io.to(roomName).emit('message deleted', messageId);
            io.to(roomName).emit('chat message', { sender: 'System (Admin)', text: `Eine Nachricht wurde gelöscht.` });
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
        }
    });

    // Normale Benutzer-Events
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

        if (!rooms[roomName]) {
            rooms[roomName] = {
                roomName,
                text: '',
                password: decryptedPassword,
                owner: socket.id,
                users: [{ id: socket.id, name: username }],
                bannedUsers: [],
                chatMessages: []
            };
            console.log(`Neuer Raum '${roomName}' erstellt von ${username}.`);
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName], socketId: socket.id, username: username });
        } else if (rooms[roomName].password === decryptedPassword) {
            if (!rooms[roomName].users.find(u => u.name === username)) {
                rooms[roomName].users.push({ id: socket.id, name: username });
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
        io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
    });

    socket.on('text changed', ({ roomName, newText }) => {
        if (rooms[roomName]) {
            rooms[roomName].text = newText;
            io.to(roomName).emit('update text', newText);
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
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
                io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
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
                    io.to(roomName).emit('chat message', { sender: 'System', text: `Eine Nachricht wurde gelöscht.` });
                    io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
                }
            }
        }
    });

    socket.on('change password', ({ roomName, newPassword }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].password = newPassword;
            io.to(roomName).emit('chat message', { sender: 'System', text: `Das Passwort wurde zu "${newPassword}" geändert.` });
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
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
                io.to(roomName).emit('chat message', { sender: 'System', text: `${userToKick.name} wurde aus dem Raum geworfen.` });
                io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
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
                io.to(roomName).emit('chat message', { sender: 'System', text: `${userToBan.name} wurde dauerhaft gebannt.` });
                io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
            }
        }
    });

    socket.on('unban user', ({ roomName, username }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].bannedUsers = rooms[roomName].bannedUsers.filter(name => name !== username);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { sender: 'System', text: `Benutzer "${username}" wurde entbannt.` });
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
        }
    });

    socket.on('delete room', ({ roomName }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Ersteller gelöscht.');
            delete rooms[roomName];
            console.log(`Raum '${roomName}' wurde gelöscht.`);
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
        }
    });

    socket.on('leave room', ({ roomName }) => {
        if (rooms[roomName]) {
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            socket.leave(roomName);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { sender: 'System', text: `Jemand hat den Raum verlassen.` });
            io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
        }
    });

    socket.on('disconnect', () => {
        console.log(`Ein Benutzer hat die Verbindung getrennt: ${socket.id}`);
        for (const roomName in rooms) {
            const initialUserCount = rooms[roomName].users.length;
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            if (rooms[roomName].users.length < initialUserCount) {
                io.to(roomName).emit('update room data', rooms[roomName]);
                io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
                if (rooms[roomName].users.length === 0) {
                    delete rooms[roomName];
                    console.log(`Raum '${roomName}' wurde gelöscht, da keine Benutzer mehr da sind.`);
                    io.to('admin-room').emit('admin:update-rooms', Object.values(rooms));
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});