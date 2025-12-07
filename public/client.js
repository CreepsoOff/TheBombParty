const socket = io();

// DOM
const views = { login: document.getElementById('login-screen'), game: document.getElementById('game-interface') };
const arena = document.getElementById('arena');
const pContainer = document.getElementById('players-container');
const pointer = document.getElementById('pointer');
const mainInput = document.getElementById('main-input');
const chatInput = document.getElementById('chat-input');
const chatFeed = document.getElementById('chat-feed');

// State
let myId = null;
let isAdmin = false;
let gameActive = false;
let currentSyllable = "";
let localPlayers = []; // Pour recalculer les positions

// --- CONNEXION ---
function joinGame() {
    const user = document.getElementById('username').value;
    if(!user) return;
    socket.emit('join-game', user);
    views.login.classList.add('hidden');
    views.game.classList.remove('hidden');
    document.addEventListener('click', (e) => {
        // Focus sur input jeu SAUF si on clique sur le chat ou params
        if(!e.target.closest('.chat-panel') && !e.target.closest('.settings-modal')) {
            mainInput.focus();
        }
    });
    mainInput.focus();
}

function sendStart() { socket.emit('start-command'); }

// --- SETTINGS ---
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
    
    // Verrouillage visuel
    const content = document.getElementById('settings-content');
    const btn = document.getElementById('save-settings-btn');
    const msg = document.getElementById('settings-lock-msg');

    const canEdit = isAdmin && !gameActive;
    
    // Désactiver/Activer les inputs
    content.querySelectorAll('input').forEach(i => i.disabled = !canEdit);
    btn.classList.toggle('hidden', !canEdit);
    msg.classList.toggle('hidden', canEdit);
}

function saveSettings() {
    if(!isAdmin) return;
    socket.emit('update-settings', {
        initialLives: parseInt(document.getElementById('set-lives').value),
        minTime: parseInt(document.getElementById('set-min').value),
        maxTime: parseInt(document.getElementById('set-max').value),
    });
    toggleSettings();
}

// --- CHAT ---
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim() !== "") {
        socket.emit('send-message', chatInput.value);
        chatInput.value = "";
    }
});

function addLog(data) {
    const div = document.createElement('div');
    if (data.type === 'system') {
        div.className = 'msg-system';
        div.innerHTML = `${data.time} [Système] ${data.text}`;
    } else {
        div.className = 'msg-player';
        div.innerHTML = `<span class="time">${data.time}</span> <span class="user">[${data.user}]</span> ${data.text}`;
    }
    chatFeed.appendChild(div);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

// --- LAYOUT CIRCULAIRE ---
function updateLayout(players) {
    localPlayers = players;
    pContainer.innerHTML = "";
    
    // Rayon du cercle (40% de la largeur ou hauteur min de l'arène)
    const radius = Math.min(arena.offsetWidth, arena.offsetHeight) * 0.35;
    const centerX = arena.offsetWidth / 2;
    const centerY = arena.offsetHeight / 2;

    players.forEach((p, index) => {
        // Calcul Angle (0 est en haut)
        const angle = (index / players.length) * 2 * Math.PI - (Math.PI / 2);
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        const card = createPlayerCard(p);
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;
        
        // Stocker l'angle pour la rotation de la flèche
        p.angle = angle; 
        
        pContainer.appendChild(card);
    });
}

function createPlayerCard(p) {
    const div = document.createElement('div');
    div.className = `player-card ${p.lives <= 0 ? 'dead' : ''}`;
    div.id = `card-${p.id}`;
    
    // Vies
    const hearts = '❤️'.repeat(p.lives);
    
    // Alphabet inversé (Gris si utilisé)
    let alphaHTML = '';
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('').forEach(char => {
        const isUsed = p.usedLetters.includes(char);
        alphaHTML += `<span class="letter ${isUsed ? 'used' : ''}" id="alpha-${p.id}-${char}">${char}</span>`;
    });

    div.innerHTML = `
        <div class="lives" id="lives-${p.id}">${hearts}</div>
        <div class="avatar">${['🤖','👽','🦊','🐱','🐯','🐸'][p.avatar]}</div>
        <div style="font-weight:bold; font-size:0.9rem;">${p.username}</div>
        <div class="typing-box" id="type-${p.id}"></div>
        <div class="alpha-grid">${alphaHTML}</div>
    `;
    return div;
}

// --- JEU & INPUTS ---
mainInput.addEventListener('input', () => socket.emit('typing', mainInput.value));
mainInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
        socket.emit('submit-word', mainInput.value);
        mainInput.value = '';
    }
});

function updateTyping(id, text) {
    const box = document.getElementById(`type-${id}`);
    if(!box) return;
    if(currentSyllable && text) {
        const reg = new RegExp(`(${currentSyllable})`, 'i');
        box.innerHTML = text.replace(reg, '<span class="hl">$1</span>');
    } else {
        box.textContent = text;
    }
}

// --- SOCKET EVENTS ---
socket.on('init-settings', (s) => {
    document.getElementById('set-lives').value = s.initialLives;
    document.getElementById('set-min').value = s.minTime;
    document.getElementById('set-max').value = s.maxTime;
});

socket.on('settings-changed', (s) => {
    document.getElementById('set-lives').value = s.initialLives;
    document.getElementById('set-min').value = s.minTime;
    document.getElementById('set-max').value = s.maxTime;
});

socket.on('update-players', (data) => {
    isAdmin = (data.adminId === socket.id);
    document.getElementById('start-overlay').classList.toggle('hidden', !isAdmin || data.players.length < 2);
    updateLayout(data.players);
});

socket.on('chat-message', addLog);

socket.on('game-started', (players) => {
    gameActive = true;
    updateLayout(players);
});

socket.on('new-turn', (data) => {
    currentSyllable = data.syllable;
    document.getElementById('syllable-display').textContent = data.syllable;
    
    // Rotation Flèche
    const targetPlayer = localPlayers.find(p => p.id === data.playerId);
    if (targetPlayer) {
        // +90deg car la flèche pointe vers le haut par défaut en CSS (ou bas selon border)
        // Ici mon border-bottom fait pointer vers le haut, donc rotation + 90
        const deg = (targetPlayer.angle * 180 / Math.PI) + 90; 
        pointer.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    }

    // Active Card
    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
    const active = document.getElementById(`card-${data.playerId}`);
    if(active) active.classList.add('active');

    // Focus input si c'est moi
    if(data.playerId === socket.id) mainInput.focus();
    mainInput.value = "";
    updateTyping(data.playerId, "");
});

socket.on('player-typing', (d) => updateTyping(d.id, d.text));

socket.on('word-success', (data) => {
    // Mise à jour alphabet (ajouter classe 'used')
    data.newLetters.forEach(c => {
        const el = document.getElementById(`alpha-${data.playerId}-${c}`);
        if(el) el.classList.add('used');
    });
    // Reset si bonus
    if(data.resetAlphabet) {
        document.querySelectorAll(`#card-${data.playerId} .letter`).forEach(el => el.classList.remove('used'));
    }
    // Vies
    document.getElementById(`lives-${data.playerId}`).textContent = '❤️'.repeat(data.lives);
});

socket.on('word-error', () => {
    const myCard = document.getElementById(`card-${socket.id}`);
    if(myCard) {
        myCard.classList.add('shake');
        setTimeout(() => myCard.classList.remove('shake'), 500);
    }
});

socket.on('explosion', (data) => {
    const bomb = document.getElementById('bomb');
    bomb.style.transform = "scale(1.5)";
    setTimeout(() => bomb.style.transform = "scale(1)", 300);
    document.getElementById(`lives-${data.loserId}`).textContent = '❤️'.repeat(data.livesLeft);
});

socket.on('player-eliminated', (id) => {
    const c = document.getElementById(`card-${id}`);
    if(c) c.classList.add('dead');
});

socket.on('game-over', () => {
    gameActive = false;
    document.getElementById('syllable-display').textContent = "FIN";
    if(isAdmin) document.getElementById('start-overlay').classList.remove('hidden');
});

socket.on('reset-game', () => {
    gameActive = false;
    document.getElementById('syllable-display').textContent = "STOP";
    if(isAdmin) document.getElementById('start-overlay').classList.remove('hidden');
});

// Redessiner le cercle si on redimensionne la fenêtre
window.addEventListener('resize', () => {
    if(localPlayers.length > 0) updateLayout(localPlayers);
});