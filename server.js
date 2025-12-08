const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

let frenchWords;
try {
    const loaded = require('an-array-of-french-words');
    frenchWords = loaded.default || loaded;
} catch (e) {
    console.error("ERREUR: npm install an-array-of-french-words");
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
    
    io.emit('new-turn', { playerId: players[currentPlayerIndex].id, syllable: currentSyllable });

    clearTimeout(timer);
    timer = setTimeout(explodeBomb, randomTime * 1000);
}

function explodeBomb() {
    const loser = players[currentPlayerIndex];
    loser.lives--;
    io.emit('explosion', { loserId: loser.id, livesLeft: loser.lives });
    
    if (loser.lives <= 0) {
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
    gameActive = false;
    clearTimeout(timer);
    io.emit('game-over', winner);
    broadcastSystemMsg(`${winner ? winner.username : 'Personne'} a gagné !`);
}

io.on('connection', (socket) => {
    socket.emit('init-settings', SETTINGS);

    socket.on('join-game', (username) => {
        if (players.length === 0) adminId = socket.id;
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

    // --- LOGIQUE CHAT MODIFIÉE ---
    socket.on('send-message', (msg) => {
        const p = players.find(x => x.id === socket.id);
        if (!p || msg.trim().length === 0) return;

        const messageData = { 
            type: 'player', 
            time: new Date().toLocaleTimeString('fr-FR'), 
            user: p.username, 
            text: msg 
        };

        if (p.lives > 0) {
            // JOUEUR VIVANT : Tout le monde voit
            io.emit('chat-message', messageData);
        } else {
            // JOUEUR MORT : Seuls les morts voient
            // On ajoute un petit indicateur visuel
            messageData.text = `💀 ${msg}`;
            messageData.isGhost = true; // Pour le style CSS si besoin

            // On envoie à tous les joueurs qui sont morts
            players.forEach(target => {
                if (target.lives <= 0) {
                    io.to(target.id).emit('chat-message', messageData);
                }
            });
            // Et on renvoie à l'envoyeur pour qu'il voit son propre message
            // (Si le sender n'est pas dans la boucle ci-dessus, ce qui ne devrait pas arriver mais sécu)
            // io.to(socket.id).emit... (déjà couvert par la boucle car il est mort)
        }
    });
    // -----------------------------

    socket.on('update-settings', (newSettings) => {
        if (socket.id !== adminId || gameActive) return;
        SETTINGS = { ...SETTINGS, ...newSettings };
        io.emit('settings-changed', SETTINGS);
        broadcastSystemMsg("Paramètres modifiés.");
    });

    socket.on('submit-word', (word) => {
        if (!gameActive || socket.id !== players[currentPlayerIndex].id) return;
        const raw = word.trim();
        const clean = normalize(raw);
        
        if (!clean.includes(currentSyllable)) { socket.emit('word-error', "Syllabe manquante !"); return; }
        if (usedWords.has(clean)) { socket.emit('word-error', "Déjà utilisé !"); return; }
        
        if (DICTIONARY.has(clean)) {
            usedWords.add(clean);
            const p = players[currentPlayerIndex];
            let newChars = [];
            for (let char of clean) {
                if (ALPHABET.includes(char) && !p.usedLetters.includes(char)) {
                    p.usedLetters.push(char);
                    newChars.push(char);
                }
            }
            let bonus = false;
            if (p.usedLetters.length >= 26) {
                p.lives++;
                p.usedLetters = [];
                bonus = true;
                broadcastSystemMsg(`${p.username} a complété l'alphabet !`);
            }
            io.emit('word-success', { playerId: socket.id, word: raw, newLetters: newChars, resetAlphabet: bonus, lives: p.lives });
            nextTurn();
        } else {
            socket.emit('word-error', "Mot inconnu !");
        }
    });

    socket.on('typing', (text) => socket.broadcast.emit('player-typing', { id: socket.id, text }));
    
    socket.on('start-command', () => {
        if (socket.id === adminId && !gameActive && players.length >= 2) {
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
        players = players.filter(x => x.id !== socket.id);
        if (socket.id === adminId && players.length > 0) adminId = players[0].id;
        io.emit('update-players', { players, adminId });
        if (gameActive && players.filter(x => x.lives > 0).length < 2) {
            gameActive = false;
            clearTimeout(timer);
            io.emit('reset-game');
        }
    });
});

server.listen(3000, () => console.log('Serveur v6.0 (Chat Morts & Input Lock) démarré'));