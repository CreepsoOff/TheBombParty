const socket = io();

// Éléments du DOM
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerList = document.getElementById('player-list');
const syllableDisplay = document.getElementById('syllable-display');
const wordInput = document.getElementById('word-input');
const statusMessage = document.getElementById('status-message');
const timerFill = document.getElementById('timer-fill');
const bomb = document.querySelector('.bomb');
const startBtn = document.getElementById('start-btn');

// --- FONCTIONS JOUEUR ---

function joinGame() {
    const username = document.getElementById('username').value;
    if (!username) return;
    
    socket.emit('join-game', username);
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
}

function startGameCmd() {
    socket.emit('start-command');
}

// Envoi du mot avec la touche Entrée
wordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        socket.emit('submit-word', wordInput.value);
        wordInput.value = '';
    }
});

// --- ÉVÉNEMENTS REÇUS DU SERVEUR ---

socket.on('update-players', (players) => {
    playerList.innerHTML = '';
    let amIAdmin = false; // Logique simple: le premier joueur est admin
    
    players.forEach((p, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.username}</span> <span>❤️ ${p.lives}</span>`;
        li.id = `p-${p.id}`;
        
        if (p.lives <= 0) li.classList.add('dead-player');
        playerList.appendChild(li);
        
        if (index === 0 && p.id === socket.id) amIAdmin = true;
    });

    // Afficher le bouton "Lancer" seulement si on est 2+ et admin (simplifié ici à tout le monde si >1)
    if (players.length >= 2) startBtn.classList.remove('hidden');
    else startBtn.classList.add('hidden');
});

socket.on('new-turn', (data) => {
    const isMyTurn = data.player.id === socket.id;
    
    syllableDisplay.textContent = data.syllable;
    statusMessage.textContent = isMyTurn ? "C'EST À TOI !" : `Tour de ${data.player.username}`;
    statusMessage.style.color = isMyTurn ? "#2ed573" : "#ccc";
    
    // Mise en évidence du joueur actif dans la liste
    document.querySelectorAll('li').forEach(li => li.classList.remove('active-player'));
    const activeLi = document.getElementById(`p-${data.player.id}`);
    if (activeLi) activeLi.classList.add('active-player');

    // Activer l'input seulement si c'est notre tour
    wordInput.disabled = !isMyTurn;
    if (isMyTurn) {
        wordInput.focus();
        wordInput.placeholder = `Contenant "${data.syllable}"...`;
    } else {
        wordInput.value = "";
        wordInput.placeholder = "Attends ton tour...";
    }

    // Reset visuels
    timerFill.style.width = '100%';
    timerFill.parentElement.classList.remove('critical');
    bomb.classList.remove('shake');
});

socket.on('timer-update', (timeLeft) => {
    const percentage = (timeLeft / 15) * 100; // 15 est le temps max
    timerFill.style.width = `${percentage}%`;
    
    if (timeLeft <= 5) {
        timerFill.parentElement.classList.add('critical');
        bomb.classList.add('shake');
    }
});

socket.on('word-success', (word) => {
    // Petit effet visuel quand un mot est validé
    const notif = document.createElement('div');
    notif.textContent = `✅ ${word}`;
    notif.style.position = 'absolute';
    notif.style.top = '20%';
    notif.style.color = '#2ed573';
    notif.style.fontSize = '2rem';
    notif.style.animation = 'fadeUp 1s forwards';
    document.querySelector('.main-area').appendChild(notif);
    setTimeout(() => notif.remove(), 1000);
});

socket.on('error-message', (msg) => {
    statusMessage.textContent = `❌ ${msg}`;
    wordInput.classList.add('error');
    setTimeout(() => wordInput.classList.remove('error'), 500);
});

socket.on('explosion', (data) => {
    statusMessage.textContent = "💥 BOOM ! 💥";
    syllableDisplay.textContent = "XXX";
    bomb.style.transform = "scale(1.5)";
    setTimeout(() => bomb.style.transform = "scale(1)", 500);
});

socket.on('game-over', (winner) => {
    statusMessage.textContent = winner ? `🏆 ${winner.username} A GAGNÉ ! 🏆` : "Fin de partie";
    syllableDisplay.textContent = "FIN";
    wordInput.disabled = true;
    startBtn.classList.remove('hidden');
});

// CSS rapide pour l'anim de succès
const style = document.createElement('style');
style.textContent = `@keyframes fadeUp { 0% { opacity:1; transform:translateY(0); } 100% { opacity:0; transform:translateY(-50px); } }`;
document.head.appendChild(style);