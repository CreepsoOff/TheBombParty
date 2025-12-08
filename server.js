const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// --- CHARGEMENT DICTIONNAIRE ---
let frenchWords;
try {
    const loaded = require('an-array-of-french-words');
    frenchWords = loaded.default || loaded;
    console.log(`[INIT] Dictionnaire chargé : ${frenchWords.length} mots.`);
} catch (e) {
    console.error("[ERREUR] npm install an-array-of-french-words");
    process.exit(1);
}

const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const DICTIONARY = new Set(frenchWords.map(w => normalize(w)));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let SETTINGS = { initialLives: 3, minTime: 10, maxTime: 25 };
const SYLLABLES = ["ON", "ENT", "RE", "ION", "TER", "QUE", "ME", "DE", "TE", "LE", "ANT", "SSE", "IE", "NE", "ES", "UR", "QU", "AR", "IN", "UI", "RA", "LA", "TI", "RI"];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let players = []; 
let currentPlayerIndex = 0;
let currentSyllable = "";
let timer = null;
let gameActive = false;
let usedWords = new Set();
let adminId = null;

function broadcastSystemMsg(msg) {
    console.log(`[CHAT SYSTEM] ${msg}`);
    io.emit('chat-message', { type: 'system', time: new Date().toLocaleTimeString('fr-FR'), text: msg });
}

function nextTurn() {
    if (!gameActive) return;
    const survivors = players.filter(p => p.lives > 0);
    if (survivors.length <= 1) { endGame(survivors[0]); return; }

    let loop = 0;
    do {
        currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
        loop++;
    } while (players[currentPlayerIndex].lives <= 0 && loop < players.length * 2);

    currentSyllable = SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
    const randomTime = Math.floor(Math.random() * (SETTINGS.maxTime - SETTINGS.minTime + 1) + SETTINGS.minTime);
    
    console.log(`[TOUR] Joueur: ${players[currentPlayerIndex].username} | Syllabe: ${currentSyllable} | Temps: ${randomTime}s`);
    
    io.emit('new-turn', { playerId: players[currentPlayerIndex].id, syllable: currentSyllable });

    clearTimeout(timer);
    timer = setTimeout(explodeBomb, randomTime * 1000);
}

function explodeBomb() {
    const loser = players[currentPlayerIndex];
    console.log(`[BOOM] La bombe a explosé sur ${loser.username} !`);
    
    loser.lives--;
    io.emit('explosion', { loserId: loser.id, livesLeft: loser.lives });
    
    if (loser.lives <= 0) {
        console.log(`[ELIMINATION] ${loser.username} est éliminé.`);
        io.emit('player-eliminated', loser.id);
        broadcastSystemMsg(`${loser.username} est éliminé !`);
    }

    setTimeout(() => {
        const survivors = players.filter(p => p.lives > 0);
        if (survivors.length <= 1) endGame(survivors[0]);
        else nextTurn();
    }, 3000);
}

function endGame(winner) {
    console.log(`[FIN PARTIE] Vainqueur: ${winner ? winner.username : 'Aucun'}`);
    gameActive = false;
    clearTimeout(timer);
    io.emit('game-over', winner);
    broadcastSystemMsg(`${winner ? winner.username : 'Personne'} a gagné !`);
}

io.on('connection', (socket) => {
    console.log(`[CONNECT] Nouvelle socket: ${socket.id}`);
    socket.emit('init-settings', SETTINGS);

    socket.on('join-game', (username) => {
        console.log(`[JOIN] Pseudo: ${username} (ID: ${socket.id})`);
        if (players.length === 0) {
            adminId = socket.id;
            console.log(`[ADMIN] ${username} est défini comme Admin.`);
        }
        
        const player = {
            id: socket.id,
            username: username || `Joueur ${players.length + 1}`,
            lives: SETTINGS.initialLives,
            usedLetters: [],
            avatar: Math.floor(Math.random() * 6)
        };
        players.push(player);
        io.emit('update-players', { players, adminId });
        socket.emit('my-data', { usedLetters: [] });
    });

    socket.on('send-message', (msg) => {
        const p = players.find(x => x.id === socket.id);
        if (p) {
            console.log(`[CHAT] ${p.username}: ${msg}`);
            io.emit('chat-message', { type: 'player', time: new Date().toLocaleTimeString('fr-FR'), user: p.username, text: msg });
        }
    });

    socket.on('update-settings', (newSettings) => {
        if (socket.id !== adminId || gameActive) return;
        console.log(`[SETTINGS] Mise à jour:`, newSettings);
        SETTINGS = { ...SETTINGS, ...newSettings };
        io.emit('settings-changed', SETTINGS);
        broadcastSystemMsg("Paramètres modifiés.");
    });

    socket.on('submit-word', (word) => {
        if (!gameActive || socket.id !== players[currentPlayerIndex].id) return;
        const raw = word.trim();
        const clean = normalize(raw);
        const p = players[currentPlayerIndex];

        console.log(`[MOT REÇU] ${p.username} tente: "${raw}" (Clean: ${clean})`);
        
        if (!clean.includes(currentSyllable)) { 
            console.log(`[REFUS] Syllabe "${currentSyllable}" manquante.`);
            socket.emit('word-error', "Syllabe manquante !"); 
            return; 
        }
        if (usedWords.has(clean)) { 
            console.log(`[REFUS] Mot déjà utilisé.`);
            socket.emit('word-error', "Déjà utilisé !"); 
            return; 
        }
        
        if (DICTIONARY.has(clean)) {
            console.log(`[VALIDE] Mot accepté !`);
            usedWords.add(clean);
            
            let newChars = [];
            for (let char of clean) {
                if (ALPHABET.includes(char) && !p.usedLetters.includes(char)) {
                    p.usedLetters.push(char);
                    newChars.push(char);
                }
            }
            let bonus = false;
            if (p.usedLetters.length >= 26) {
                console.log(`[BONUS] ${p.username} a complété l'alphabet !`);
                p.lives++;
                p.usedLetters = [];
                bonus = true;
                broadcastSystemMsg(`${p.username} a complété l'alphabet !`);
            }
            io.emit('word-success', { playerId: socket.id, word: raw, newLetters: newChars, resetAlphabet: bonus, lives: p.lives });
            nextTurn();
        } else {
            console.log(`[REFUS] Mot inconnu au dictionnaire.`);
            socket.emit('word-error', "Mot inconnu !");
        }
    });

    socket.on('typing', (text) => socket.broadcast.emit('player-typing', { id: socket.id, text }));
    
    socket.on('start-command', () => {
        if (socket.id === adminId && !gameActive && players.length >= 2) {
            console.log(`[START] Lancement de la partie !`);
            gameActive = true;
            usedWords.clear();
            currentPlayerIndex = 0;
            players.forEach(p => { p.lives = SETTINGS.initialLives; p.usedLetters = []; });
            io.emit('game-started', players);
            broadcastSystemMsg("La partie commence !");
            nextTurn();
        }
    });

    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] Socket ${socket.id}`);
        players = players.filter(x => x.id !== socket.id);
        if (socket.id === adminId && players.length > 0) {
            adminId = players[0].id;
            console.log(`[ADMIN] Nouveau Admin: ${players[0].username}`);
        }
        io.emit('update-players', { players, adminId });
        if (gameActive && players.filter(x => x.lives > 0).length < 2) {
            console.log(`[STOP] Partie annulée (manque de joueurs).`);
            gameActive = false;
            clearTimeout(timer);
            io.emit('reset-game');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur v5.1 (Logs Activés) démarré sur port ${PORT}`));