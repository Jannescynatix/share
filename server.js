const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const sanitizeHtml = require('sanitize-html');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Konfiguration ---
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mowwus';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const MESSAGE_LIMIT = 500; // Maximale Anzahl von Chat-Nachrichten pro Raum
const ROOM_INACTIVITY_TIMEOUT = 1000 * 60 * 60; // 1 Stunde Inaktivität

// --- Brute-Force-Schutz Konfiguration ---
const MAX_LOGIN_ATTEMPTS_PER_SECOND = 2;
const GLOBAL_LOCKOUT_DURATION = 1000 * 60; // 1 Minute
let failedLoginAttempts = [];
let isGloballyLockedOut = false;

// --- Globale Variablen ---
const rooms = {};
const adminAuth = new Map(); // Speichert, welche Socket-IDs als Admin authentifiziert sind
let HASHED_ADMIN_PASSWORD;

// --- Helferfunktionen für die Verschlüsselung ---
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

const encrypt = (text, key) => {
    if (!key) return text;
    try {
        const derivedKey = crypto.scryptSync(key, 'salt', KEY_LENGTH);
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (e) {
        console.error("Fehler beim Verschlüsseln des Passworts:", e);
        return text;
    }
};

const decrypt = (text, key) => {
    if (!key || !text || !text.includes(':')) return text;
    try {
        const [ivHex, encryptedText] = text.split(':');
        if (!ivHex || !encryptedText) return text;
        const derivedKey = crypto.scryptSync(key, 'salt', KEY_LENGTH);
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error("Fehler beim Entschlüsseln des Passworts:", e);
        return text;
    }
};

const getStats = () => {
    const activeRoomsCount = Object.keys(rooms).length;
    const activeUsersCount = Object.values(rooms).reduce((sum, room) => sum + room.users.length, 0);
    const roomsByUserCount = Object.values(rooms).reduce((acc, room) => {
        acc[room.roomName] = room.users.length;
        return acc;
    }, {});
    const mostPopularRoom = Object.entries(roomsByUserCount).sort(([, a], [, b]) => b - a)[0];

    const sessionDurations = Object.values(rooms).flatMap(room => room.users.map(user => Date.now() - user.joinTime));
    const averageSessionDuration = sessionDurations.length ? sessionDurations.reduce((a, b) => a + b) / sessionDurations.length : 0;

    return {
        activeRoomsCount,
        activeUsersCount,
        mostPopularRoom,
        averageSessionDuration
    };
};

const deleteInactiveRooms = () => {
    const now = Date.now();
    for (const roomName in rooms) {
        if (rooms[roomName].users.length === 0 && (now - rooms[roomName].lastActivity > ROOM_INACTIVITY_TIMEOUT)) {
            console.log(`Lösche inaktiven Raum: ${roomName}`);
            delete rooms[roomName];
        }
    }
};

const getRoomsForAdmin = () => {
    const roomsWithDecryptedPasswords = Object.values(rooms).map(room => {
        const roomCopy = { ...room };
        roomCopy.password = decrypt(roomCopy.password, ENCRYPTION_KEY);
        return roomCopy;
    });
    return roomsWithDecryptedPasswords;
};

// --- Initialisierung ---
// Hash des Admin-Passworts beim Serverstart
bcrypt.hash(ADMIN_PASSWORD, 10, (err, hash) => {
    if (err) {
        console.error('Fehler beim Hashing des Admin-Passworts:', err);
    } else {
        HASHED_ADMIN_PASSWORD = hash;
        console.log('Admin-Passwort erfolgreich gehasht.');
    }
});

// Überprüfe und lösche inaktive Räume alle 30 Minuten
setInterval(deleteInactiveRooms, 1000 * 60 * 30);

// --- Statische Dateien ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- Brute-Force-Schutz-Logik ---
const checkBruteForce = (callback) => {
    // Filtere alle fehlgeschlagenen Versuche, die älter als 1 Sekunde sind
    const now = Date.now();
    failedLoginAttempts = failedLoginAttempts.filter(timestamp => now - timestamp < 1000);

    // Wenn zu viele Versuche in der letzten Sekunde stattfanden
    if (failedLoginAttempts.length > MAX_LOGIN_ATTEMPTS_PER_SECOND) {
        if (!isGloballyLockedOut) {
            isGloballyLockedOut = true;
            console.warn('Brute-Force-Angriff erkannt! Server gesperrt.');
            setTimeout(() => {
                isGloballyLockedOut = false;
                failedLoginAttempts = [];
                console.log('Globale Sperre aufgehoben.');
            }, GLOBAL_LOCKOUT_DURATION);
        }
        callback(true);
    } else {
        callback(false);
    }
};

// --- Socket.io-Verbindung ---
io.on('connection', (socket) => {
    console.log('Neuer Benutzer verbunden:', socket.id);

    // --- Admin-Funktionen ---
    socket.on('admin:login', async (password) => {
        checkBruteForce((isLockedOut) => {
            if (isLockedOut) {
                socket.emit('login failed', `System wurde vermutlich angegriffen. Bitte versuche es in etwa ${GLOBAL_LOCKOUT_DURATION / 1000} Sekunden erneut.`);
                return;
            }

            const isMatch = bcrypt.compare(password, HASHED_ADMIN_PASSWORD);
            if (isMatch) {
                adminAuth.set(socket.id, true);
                socket.join('admin-room');
                socket.emit('admin:authenticated', { rooms: getRoomsForAdmin(), stats: getStats() });
                console.log(`Admin ${socket.id} hat sich angemeldet.`);
            } else {
                failedLoginAttempts.push(Date.now());
                socket.emit('admin:auth-failed');
            }
        });
    });

    socket.on('admin:delete-room', (roomName) => {
        if (adminAuth.has(socket.id) && rooms[roomName]) {
            console.log(`Admin ${socket.id} löscht Raum: ${roomName}`);
            io.to(roomName).emit('room deleted', 'Dieser Raum wurde vom Administrator gelöscht.');
            delete rooms[roomName];
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
    });

    socket.on('admin:kick-user', ({ roomName, userId }) => {
        if (adminAuth.has(socket.id) && rooms[roomName]) {
            const userSocket = io.sockets.sockets.get(userId);
            if (userSocket) {
                console.log(`Admin ${socket.id} kickt Benutzer ${userId} aus Raum ${roomName}`);
                userSocket.emit('kicked', 'Du wurdest vom Administrator gekickt.');
                userSocket.leave(roomName);
                rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== userId);
                const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
                io.to(roomName).emit('update room data', roomDataToSend);
                io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
            }
        }
    });

    socket.on('admin:delete-message', ({ roomName, messageId }) => {
        if (adminAuth.has(socket.id) && rooms[roomName]) {
            rooms[roomName].chatMessages = rooms[roomName].chatMessages.filter(msg => msg.id !== messageId);
            io.to(roomName).emit('message deleted', messageId);
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
    });

    // --- Benutzer-Funktionen ---
    socket.on('join room', ({ roomName, password, username }) => {
        checkBruteForce((isLockedOut) => {
            if (isLockedOut) {
                socket.emit('login failed', `System wurde vermutlich angegriffen. Bitte versuche es in etwa ${GLOBAL_LOCKOUT_DURATION / 1000} Sekunden erneut.`);
                return;
            }

            let roomPassword = password;
            if (ENCRYPTION_KEY) {
                roomPassword = decrypt(password, ENCRYPTION_KEY);
            }

            if (!rooms[roomName]) {
                rooms[roomName] = {
                    roomName,
                    password: encrypt(roomPassword, ENCRYPTION_KEY),
                    owner: socket.id,
                    users: [],
                    text: '',
                    chatMessages: [],
                    bannedUsers: [],
                    lastActivity: Date.now()
                };
            }

            if (decrypt(rooms[roomName].password, ENCRYPTION_KEY) !== roomPassword) {
                failedLoginAttempts.push(Date.now());
                socket.emit('login failed', 'Falsches Passwort.');
                return;
            }
            if (rooms[roomName].bannedUsers.includes(username)) {
                socket.emit('login failed', 'Du wurdest aus diesem Raum gebannt.');
                return;
            }

            socket.join(roomName);
            const userDetails = {
                id: socket.id,
                name: username,
                ip: socket.handshake.address,
                browser: socket.request.headers['user-agent'],
                joinTime: Date.now()
            };
            rooms[roomName].users.push(userDetails);
            rooms[roomName].lastActivity = Date.now();
            const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
            socket.emit('login successful', { room: roomDataToSend, socketId: socket.id });
            socket.emit('update text', rooms[roomName].text);
            socket.emit('load messages', rooms[roomName].chatMessages);
            io.to(roomName).emit('update room data', roomDataToSend);
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
            console.log(`Benutzer ${username} ist dem Raum ${roomName} beigetreten.`);
        });
    });

    socket.on('text changed', ({ roomName, newText }) => {
        if (rooms[roomName]) {
            const sanitizedText = sanitizeHtml(newText, {
                allowedTags: [],
                allowedAttributes: {}
            });
            rooms[roomName].text = sanitizedText;
            socket.to(roomName).emit('update text', sanitizedText);
            rooms[roomName].lastActivity = Date.now();
        }
    });

    socket.on('chat message', ({ roomName, message }) => {
        if (rooms[roomName]) {
            const sanitizedMessage = sanitizeHtml(message, {
                allowedTags: [],
                allowedAttributes: {}
            });
            const user = rooms[roomName].users.find(u => u.id === socket.id);
            if (user) {
                const messageData = {
                    id: Date.now(),
                    senderId: socket.id,
                    senderName: user.name,
                    text: sanitizedMessage,
                    timestamp: new Date()
                };
                rooms[roomName].chatMessages.push(messageData);
                if (rooms[roomName].chatMessages.length > MESSAGE_LIMIT) {
                    rooms[roomName].chatMessages.shift();
                }
                io.to(roomName).emit('new message', messageData);
                io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
            }
            rooms[roomName].lastActivity = Date.now();
        }
    });

    socket.on('delete message', ({ roomName, messageId }) => {
        if (rooms[roomName] && (rooms[roomName].owner === socket.id || rooms[roomName].chatMessages.some(msg => msg.id === messageId && msg.senderId === socket.id))) {
            rooms[roomName].chatMessages = rooms[roomName].chatMessages.filter(msg => msg.id !== messageId);
            io.to(roomName).emit('message deleted', messageId);
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
    });

    socket.on('leave room', ({ roomName }) => {
        if (rooms[roomName]) {
            socket.leave(roomName);
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
            io.to(roomName).emit('update room data', roomDataToSend);
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
    });

    socket.on('kick user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            const userSocket = io.sockets.sockets.get(userId);
            if (userSocket) {
                userSocket.emit('kicked', 'Du wurdest vom Raumersteller gekickt.');
                userSocket.leave(roomName);
                rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== userId);
                const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
                io.to(roomName).emit('update room data', roomDataToSend);
                io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
            }
        }
    });

    socket.on('ban user', ({ roomName, userId }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            const userToBan = rooms[roomName].users.find(user => user.id === userId);
            if (userToBan) {
                rooms[roomName].bannedUsers.push(userToBan.name);
                const userSocket = io.sockets.sockets.get(userId);
                if (userSocket) {
                    userSocket.emit('kicked', 'Du wurdest vom Raumersteller gebannt.');
                    userSocket.leave(roomName);
                }
                rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== userId);
                const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
                io.to(roomName).emit('update room data', roomDataToSend);
                io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
            }
        }
    });

    socket.on('unban user', ({ roomName, username }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            rooms[roomName].bannedUsers = rooms[roomName].bannedUsers.filter(name => name !== username);
            const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
            io.to(roomName).emit('update room data', roomDataToSend);
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
    });

    socket.on('change password', ({ roomName, newPassword }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            let passwordToSave = newPassword;
            if (ENCRYPTION_KEY) {
                passwordToSave = encrypt(newPassword, ENCRYPTION_KEY);
            }
            rooms[roomName].password = passwordToSave;
            const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
            io.to(roomName).emit('update room data', roomDataToSend);
        }
    });

    socket.on('delete room', ({ roomName }) => {
        if (rooms[roomName] && rooms[roomName].owner === socket.id) {
            io.to(roomName).emit('room deleted', 'Der Raumersteller hat diesen Raum gelöscht.');
            delete rooms[roomName];
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
    });

    socket.on('disconnect', () => {
        console.log('Benutzer getrennt:', socket.id);
        if (adminAuth.has(socket.id)) {
            adminAuth.delete(socket.id);
            io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
        }
        for (const roomName in rooms) {
            const initialUserCount = rooms[roomName].users.length;
            rooms[roomName].users = rooms[roomName].users.filter(user => user.id !== socket.id);
            if (rooms[roomName].users.length < initialUserCount) {
                rooms[roomName].lastActivity = Date.now();
                const roomDataToSend = { ...rooms[roomName], password: decrypt(rooms[roomName].password, ENCRYPTION_KEY) };
                io.to(roomName).emit('update room data', roomDataToSend);
                io.to('admin-room').emit('admin:update-rooms', { rooms: getRoomsForAdmin(), stats: getStats() });
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});