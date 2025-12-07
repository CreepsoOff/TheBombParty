const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// --- CHARGEMENT DICTIONNAIRE ---
let frenchWords;
try {
    const loaded = require('an-array-of-french-words');
    frenchWords = loaded.default || loaded;
} catch (e) {
    console.error("ERREUR: Installez le dico -> npm install an-array-of-french-words");
    process.exit(1);
}

// Normalisation (E = É = È)
const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const DICTIONARY = new Set(frenchWords.map(w => normalize(w)));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURATION ---
let SETTINGS = {
    initialLives: 3,
    minTime: 10,
    maxTime: 25,
    syllableDifficulty: 1 // Pas utilisé dans ce code simple, mais prêt pour extension
};

const SYLLABLES = ["ON", "ENT", "RE", "ION", "TER", "QUE", "ME", "DE", "TE", "LE", "ANT", "SSE", "IE", "NE", "ES", "UR", "QU", "AR", "IN", "UI", "RA", "LA"];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let players = []; 
let currentPlayerIndex = 0;
let currentSyllable = "";
let timer = null;
let gameActive = false;
let usedWords = new Set();

// --- LOGIQUE ---

function startGame() {
    if (players.length < 2) return;
    gameActive = true;
    usedWords.clear();
    currentPlayerIndex = 0; // Le premier joueur commence
    
    // Reset des alphabets
    players.forEach(p => {
        p.lives = SETTINGS.initialLives;
        p.usedLetters = [];
    });
    
    io.emit('game-started', players);
    nextTurn();
}

function nextTurn() {
    if (!gameActive) return;

    // Vérifier survivants
    const survivors = players.filter(p => p.lives > 0);
    if (survivors.length <= 1) {
        endGame(survivors[0]);
        return;
    }

    // Trouver le prochain joueur vivant
    let loop = 0;
    do {
        currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
        loop++;
    } while (players[currentPlayerIndex].lives <= 0 && loop < players.length * 2);

    currentSyllable = SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
    
    // TEMPS ALÉATOIRE
    const randomTime = Math.floor(Math.random() * (SETTINGS.maxTime - SETTINGS.minTime + 1) + SETTINGS.minTime);
    
    io.emit('new-turn', {
        playerId: players[currentPlayerIndex].id,
        syllable: currentSyllable,
        // On n'envoie PAS le temps exact au client pour garder le suspense
    });

    // Gestion du timer côté serveur uniquement
    clearInterval(timer);
    timer = setTimeout(() => {
        explodeBomb();
    }, randomTime * 1000);
}

function explodeBomb() {
    const loser = players[currentPlayerIndex];
    loser.lives--;
    
    io.emit('explosion', { loserId: loser.id, livesLeft: loser.lives });
    io.emit('play-sound', 'explosion');

    if (loser.lives <= 0) {
        io.emit('player-eliminated', loser.id);
    }

    // Pause dramatique
    setTimeout(() => {
        if (players.filter(p => p.lives > 0).length <= 1) {
             endGame(players.filter(p => p.lives > 0)[0]);
        } else {
            nextTurn();
        }
    }, 3000);
}

function endGame(winner) {
    gameActive = false;
    clearTimeout(timer);
    io.emit('game-over', winner);
}

// --- SOCKETS ---

io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        const player = {
            id: socket.id,
            username: username || `Joueur ${players.length + 1}`,
            lives: SETTINGS.initialLives,
            usedLetters: [], // Pour le bonus alphabet
            avatar: Math.floor(Math.random() * 5) + 1 // Simule un avatar différent
        };
        players.push(player);
        io.emit('update-players', players);
    });

    socket.on('typing', (text) => {
        // Diffuser ce que le joueur tape aux autres pour l'affichage sous l'avatar
        socket.broadcast.emit('player-typing', { id: socket.id, text: text });
    });

    socket.on('submit-word', (word) => {
        if (!gameActive) return;
        if (socket.id !== players[currentPlayerIndex].id) return;

        const rawWord = word.trim();
        const cleanWord = normalize(rawWord);
        
        // 1. Validation Syllabe
        if (!cleanWord.includes(currentSyllable)) {
            socket.emit('word-error', "Syllabe manquante !");
            return;
        }
        
        // 2. Validation Déjà utilisé
        if (usedWords.has(cleanWord)) {
            socket.emit('word-error', "Déjà utilisé !");
            return;
        }

        // 3. Validation Dictionnaire
        if (DICTIONARY.has(cleanWord)) {
            usedWords.add(cleanWord);
            
            // GESTION ALPHABET
            const player = players[currentPlayerIndex];
            let newLetters = [];
            for (let char of cleanWord) {
                if (ALPHABET.includes(char) && !player.usedLetters.includes(char)) {
                    player.usedLetters.push(char);
                    newLetters.push(char);
                }
            }

            let bonusLife = false;
            // Bonus vie si alphabet complet
            if (player.usedLetters.length >= 26) {
                player.lives++;
                player.usedLetters = []; // Reset
                bonusLife = true;
            }

            io.emit('word-success', { 
                playerId: socket.id, 
                word: rawWord, 
                newLetters: newLetters,
                resetAlphabet: bonusLife,
                lives: player.lives
            }); 
            
            nextTurn();
        } else {
            socket.emit('word-error', "Inconnu au bataillon !");
        }
    });

    socket.on('update-settings', (newSettings) => {
        // Dans un vrai jeu, vérifier si admin
        SETTINGS = { ...SETTINGS, ...newSettings };
        console.log("Paramètres mis à jour", SETTINGS);
    });

    socket.on('start-command', () => {
        if (!gameActive && players.length >= 2) startGame();
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('update-players', players);
        if (gameActive && players.filter(p => p.lives > 0).length < 2) {
            gameActive = false;
            clearTimeout(timer);
            io.emit('reset-game');
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Serveur BombParty 2.0 sur http://localhost:${PORT}`));