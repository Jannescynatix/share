// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Speicher für die Räume. Jeder Raum hat seinen eigenen Text, Passwort, Nutzerliste, Ban-Liste und Ersteller.
const rooms = {};

// Statische Dateien aus dem 'public' Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Entschlüsselungsfunktion
function decrypt(text, key) {
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

io.on('connection', (socket) => {
    console.log(`Ein Benutzer hat sich verbunden: ${socket.id}`);

    socket.on('join room', ({ roomName, password, username }) => {
        // Entschlüssele das Passwort, das aus der URL kommen könnte
        let decryptedPassword = password;
        if (password && process.env.ENCRYPTION_KEY) {
            try {
                decryptedPassword = decrypt(password, process.env.ENCRYPTION_KEY);
            } catch (e) {
                console.error("Fehler beim Entschlüsseln des Passworts:", e);
                socket.emit('login failed', 'Fehler beim Passwort.');
                return;
            }
        }

        if (rooms[roomName] && rooms[roomName].bannedUsers && rooms[roomName].bannedUsers.includes(socket.id)) {
            socket.emit('login failed', 'Du wurdest dauerhaft aus diesem Raum gebannt.');
            return;
        }

        if (!rooms[roomName]) {
            rooms[roomName] = {
                text: '',
                password: decryptedPassword,
                owner: socket.id,
                users: [{ id: socket.id, name: username }],
                bannedUsers: []
            };
            console.log(`Neuer Raum '${roomName}' erstellt von ${username}.`);
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName], socketId: socket.id });
        } else if (rooms[roomName].password === decryptedPassword) {
            rooms[roomName].users.push({ id: socket.id, name: username });
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName], socketId: socket.id });
            console.log(`Benutzer '${username}' ist Raum '${roomName}' beigetreten.`);
        } else {
            socket.emit('login failed', 'Falsches Passwort.');
            return;
        }

        io.to(roomName).emit('update text', rooms[roomName].text);
        io.to(roomName).emit('update room data', rooms[roomName]);
    });

    socket.on('text changed', ({ roomName, newText }) => {
        if (rooms[roomName]) {
            rooms[roomName].text = newText;
            io.to(roomName).emit('update text', newText);
        }
    });

    socket.on('chat message', ({ roomName, message }) => {
        if (rooms[roomName]) {
            const user = rooms[roomName].users.find(u => u.id === socket.id);
            if (user) {
                io.to(roomName).emit('chat message', { sender: user.name, text: message });
            }
        }
    });

    socket.on('change password', ({ roomName, newPassword }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].password = newPassword;
            io.to(roomName).emit('chat message', { sender: 'System', text: `Das Passwort wurde zu "${newPassword}" geändert.` });
            io.to(roomName).emit('update room data', rooms[roomName]);
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
            }
        }
    });

    socket.on('ban user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            const userToBan = rooms[roomName].users.find(u => u.id === userId);
            if (userToBan && userToBan.id !== rooms[roomName].owner) {
                rooms[roomName].bannedUsers.push(userId);
                const clientSocket = io.sockets.sockets.get(userId);
                if (clientSocket) {
                    clientSocket.leave(roomName);
                    clientSocket.emit('kicked', 'Du wurdest dauerhaft aus diesem Raum gebannt.');
                }
                rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== userId);
                io.to(roomName).emit('update room data', rooms[roomName]);
                io.to(roomName).emit('chat message', { sender: 'System', text: `${userToBan.name} wurde dauerhaft gebannt.` });
            }
        }
    });

    socket.on('unban user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].bannedUsers = rooms[roomName].bannedUsers.filter(id => id !== userId);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { sender: 'System', text: `Ein Nutzer wurde entbannt.` });
        }
    });

    socket.on('delete room', ({ roomName }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Ersteller gelöscht.');
            delete rooms[roomName];
            console.log(`Raum '${roomName}' wurde gelöscht.`);
        }
    });

    socket.on('leave room', ({ roomName }) => {
        if (rooms[roomName]) {
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            socket.leave(roomName);
            io.to(roomName).emit('update room data', rooms[roomName]);
            io.to(roomName).emit('chat message', { sender: 'System', text: `${socket.id} hat den Raum verlassen.` });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Ein Benutzer hat die Verbindung getrennt: ${socket.id}`);
        for (const roomName in rooms) {
            const initialUserCount = rooms[roomName].users.length;
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            if (rooms[roomName].users.length < initialUserCount) {
                io.to(roomName).emit('update room data', rooms[roomName]);
                if (rooms[roomName].users.length === 0) {
                    delete rooms[roomName];
                    console.log(`Raum '${roomName}' wurde gelöscht, da keine Benutzer mehr da sind.`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});