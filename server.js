// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Speicher für die Räume. Jeder Raum hat seinen eigenen Text, Passwort, Nutzerliste und Ersteller.
const rooms = {};

// Statische Dateien aus dem 'public' Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`Ein Benutzer hat sich verbunden: ${socket.id}`);

    // Benutzer tritt einem Raum bei
    socket.on('join room', ({ roomName, password, username }) => {
        if (!rooms[roomName]) {
            // Wenn der Raum nicht existiert, wird er erstellt
            rooms[roomName] = {
                text: '',
                password: password,
                owner: socket.id,
                users: [{ id: socket.id, name: username }],
            };
            console.log(`Neuer Raum '${roomName}' erstellt von ${username}.`);
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName] });
        } else if (rooms[roomName].password === password) {
            // Wenn der Raum existiert und das Passwort korrekt ist, tritt der Benutzer bei
            rooms[roomName].users.push({ id: socket.id, name: username });
            socket.join(roomName);
            socket.emit('login successful', { room: rooms[roomName] });
            console.log(`Benutzer '${username}' ist Raum '${roomName}' beigetreten.`);
        } else {
            socket.emit('login failed', 'Falsches Passwort.');
            return;
        }

        // Sende den aktuellen Text und die Nutzerliste an alle im Raum
        io.to(roomName).emit('update text', rooms[roomName].text);
        io.to(roomName).emit('update users', rooms[roomName].users);
    });

    // Höre auf Text-Änderungen in einem bestimmten Raum
    socket.on('text changed', ({ roomName, newText }) => {
        if (rooms[roomName]) {
            rooms[roomName].text = newText;
            io.to(roomName).emit('update text', newText);
        }
    });

    // Höre auf Chat-Nachrichten in einem bestimmten Raum
    socket.on('chat message', ({ roomName, message }) => {
        if (rooms[roomName]) {
            const user = rooms[roomName].users.find(u => u.id === socket.id);
            if (user) {
                io.to(roomName).emit('chat message', { sender: user.name, text: message });
            }
        }
    });

    // Höre auf 'kick user' event (nur vom Raumersteller)
    socket.on('kick user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            const userToKick = rooms[roomName].users.find(u => u.id === userId);
            if (userToKick && userToKick.id !== rooms[roomName].owner) {
                // Finde den Socket des Benutzers und trenne ihn
                const clientSocket = io.sockets.sockets.get(userId);
                if (clientSocket) {
                    clientSocket.leave(roomName);
                    clientSocket.emit('kicked', 'Du wurdest aus dem Raum geworfen.');
                    console.log(`Benutzer ${userToKick.name} aus Raum ${roomName} geworfen.`);
                }
                rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== userId);
                io.to(roomName).emit('update users', rooms[roomName].users);
                io.to(roomName).emit('chat message', { sender: 'System', text: `${userToKick.name} wurde aus dem Raum geworfen.` });
            }
        }
    });

    // Höre auf 'delete room' event (nur vom Raumersteller)
    socket.on('delete room', ({ roomName }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Ersteller gelöscht.');
            delete rooms[roomName];
            console.log(`Raum '${roomName}' wurde gelöscht.`);
        }
    });

    // Höre auf 'leave room' event
    socket.on('leave room', ({ roomName }) => {
        if (rooms[roomName]) {
            rooms[roomName].users = rooms[roomName].users.filter(u => u.id !== socket.id);
            socket.leave(roomName);
            io.to(roomName).emit('update users', rooms[roomName].users);
            io.to(roomName).emit('chat message', { sender: 'System', text: `${socket.id} hat den Raum verlassen.` });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Ein Benutzer hat die Verbindung getrennt: ${socket.id}`);
        // Entferne den Benutzer aus allen Räumen
        for (const roomName in rooms) {
            const initialUserCount = rooms[roomName].users.length;
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            if (rooms[roomName].users.length < initialUserCount) {
                io.to(roomName).emit('update users', rooms[roomName].users);
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