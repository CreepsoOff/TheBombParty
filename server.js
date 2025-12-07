const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// --- CHARGEMENT DU DICTIONNAIRE ---
// On utilise le paquet "an-array-of-french-words" comme dans le repo que tu as montré
let frenchWords;
try {
    const loaded = require('an-array-of-french-words');
    frenchWords = loaded.default || loaded;
} catch (e) {
    console.error("ERREUR CRITIQUE : Le module 'an-array-of-french-words' n'est pas installé.");
    console.error("Exécutez : npm install an-array-of-french-words");
    process.exit(1);
}

// Optimisation : On crée un "Set" pour vérifier si un mot existe en une fraction de seconde
// On nettoie aussi les accents pour permettre de taper "ELEPHANT" pour "ÉLÉPHANT"
const DICTIONARY = new Set(frenchWords.map(w => w.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
console.log(`📚 Dictionnaire chargé : ${DICTIONARY.size} mots prêts !`);

// --- CONFIGURATION SERVEUR ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- PARAMÈTRES DU JEU ---
const INITIAL_LIVES = 3;
const BOMB_TIME = 15; // 15 secondes par tour
const SYLLABLES = ["ON", "ENT", "RE", "ION", "TER", "QUE", "ME", "DE", "TE", "LE", "ANT", "SSE", "IE", "NE", "ES", "UR", "QU", "AR", "IN"];

let players = []; 
let currentPlayerIndex = 0;
let currentSyllable = "";
let timer = null;
let timeLeft = BOMB_TIME;
let gameActive = false;
let usedWords = new Set(); // Mots déjà utilisés dans la partie

// --- FONCTIONS DU JEU ---

function startGame() {
    if (players.length < 2) return; // Il faut au moins 2 joueurs
    gameActive = true;
    usedWords.clear();
    currentPlayerIndex = 0;
    
    io.emit('game-started');
    nextTurn();
}

function nextTurn() {
    if (!gameActive) return;
    
    // Vérifier les survivants
    const survivors = players.filter(p => p.lives > 0);
    if (survivors.length <= 1) {
        endGame(survivors[0]);
        return;
    }

    // Passer au joueur suivant (en sautant les morts)
    let safetyLoop = 0;
    do {
        currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
        safetyLoop++;
    } while (players[currentPlayerIndex].lives <= 0 && safetyLoop < players.length * 2);

    // Préparer le tour
    currentSyllable = SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
    timeLeft = BOMB_TIME;
    
    io.emit('new-turn', {
        player: players[currentPlayerIndex],
        syllable: currentSyllable,
        timeLeft: timeLeft
    });

    startTimer();
}

function startTimer() {
    clearInterval(timer);
    timer = setInterval(() => {
        timeLeft--;
        io.emit('timer-update', timeLeft);

        if (timeLeft <= 0) {
            explodeBomb();
        }
    }, 1000);
}

function explodeBomb() {
    clearInterval(timer);
    const loser = players[currentPlayerIndex];
    loser.lives--;
    
    io.emit('explosion', { loserId: loser.id, livesLeft: loser.lives });

    if (loser.lives <= 0) {
        io.emit('player-eliminated', loser);
    }

    // Pause de 2 secondes avant la suite
    setTimeout(() => {
        nextTurn();
    }, 2000);
}

function endGame(winner) {
    gameActive = false;
    clearInterval(timer);
    io.emit('game-over', winner);
}

// --- GESTION DES CONNEXIONS (SOCKET.IO) ---

io.on('connection', (socket) => {
    console.log('Nouveau joueur :', socket.id);

    // 1. Un joueur rejoint
    socket.on('join-game', (username) => {
        const player = {
            id: socket.id,
            username: username || `Joueur ${players.length + 1}`,
            lives: INITIAL_LIVES
        };
        players.push(player);
        io.emit('update-players', players);
    });

    // 2. Un joueur propose un mot
    socket.on('submit-word', (word) => {
        if (!gameActive) return;
        // Vérifier que c'est bien son tour
        if (socket.id !== players[currentPlayerIndex].id) return;

        // Nettoyage : Majuscules + Sans accents
        const cleanWord = word.toUpperCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        // Validation A : Syllabe présente ?
        if (!cleanWord.includes(currentSyllable)) {
            socket.emit('error-message', `Le mot doit contenir "${currentSyllable}"`);
            return;
        }
        
        // Validation B : Déjà utilisé ?
        if (usedWords.has(cleanWord)) {
            socket.emit('error-message', "Mot déjà utilisé !");
            return;
        }

        // Validation C : Existe dans le dictionnaire ?
        if (DICTIONARY.has(cleanWord)) {
            usedWords.add(cleanWord);
            io.emit('word-success', cleanWord); // Mot validé !
            nextTurn();
        } else {
            socket.emit('error-message', "Ce mot n'existe pas !");
        }
    });

    // 3. Commande pour lancer la partie
    socket.on('start-command', () => {
        if (!gameActive && players.length >= 2) {
            startGame();
        }
    });

    // 4. Déconnexion
    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('update-players', players);
        
        // Arrêter si trop peu de joueurs
        if (gameActive && players.filter(p => p.lives > 0).length < 2) {
            gameActive = false;
            clearInterval(timer);
            io.emit('reset-game');
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Serveur prêt sur http://localhost:${PORT}`));