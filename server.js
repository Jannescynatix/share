// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Speicher für die Räume (Jeder Raum hat seinen eigenen Text und sein eigenes Passwort)
const rooms = {};

// Statische Dateien aus dem 'public' Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Ein Benutzer hat sich verbunden');

    // Benutzer tritt einem Raum bei
    socket.on('join room', ({ roomName, password }) => {
        if (!rooms[roomName]) {
            // Wenn der Raum nicht existiert, wird er erstellt und das Passwort gesetzt
            rooms[roomName] = { text: '', password };
            console.log(`Neuer Raum '${roomName}' erstellt.`);
        }

        if (rooms[roomName].password === password) {
            socket.join(roomName);
            socket.emit('login successful');
            socket.emit('update text', rooms[roomName].text);
            console.log(`Benutzer ist Raum '${roomName}' beigetreten.`);
        } else {
            socket.emit('login failed');
        }
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
            io.to(roomName).emit('chat message', message);
        }
    });

    socket.on('disconnect', () => {
        console.log('Ein Benutzer hat die Verbindung getrennt');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});