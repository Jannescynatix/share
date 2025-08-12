// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Speicher für den Text und das Passwort
let sharedText = '';
const password = process.env.PASSWORD; // Das Passwort wird aus der Umgebungsvariable gelesen

// Wenn kein Passwort in der Umgebungsvariable gesetzt ist, wird der Server beendet
if (!password) {
    console.error('FEHLER: Kein Passwort in den Umgebungsvariablen gefunden. Bitte setze die Umgebungsvariable "PASSWORD".');
    process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Ein Benutzer hat sich verbunden');

    // Sende den aktuellen Text an den neu verbundenen Benutzer
    socket.emit('update text', sharedText);

    // Höre auf Passwort-Versuche
    socket.on('login attempt', (attempt) => {
        if (attempt === password) {
            socket.emit('login successful');
        } else {
            socket.emit('login failed');
        }
    });

    // Höre auf Änderungen im Text
    socket.on('text changed', (newText) => {
        sharedText = newText;
        // Sende die Änderung an alle anderen verbundenen Clients
        socket.broadcast.emit('update text', sharedText);
    });

    socket.on('disconnect', () => {
        console.log('Ein Benutzer hat die Verbindung getrennt');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});