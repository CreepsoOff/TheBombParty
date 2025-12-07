const socket = io();

// DOM
const views = { login: document.getElementById('login-screen'), game: document.getElementById('game-interface') };
const arena = document.getElementById('arena');
const pContainer = document.getElementById('players-container');
const pointer = document.getElementById('pointer');
const mainInput = document.getElementById('main-input');
const chatFeed = document.getElementById('chat-feed');
const localAlphaGrid = document.getElementById('local-alphabet-grid');

// AUDIO (Liens stables)
const audioCtx = {
    pop: new Audio('https://raw.githubusercontent.com/victrme/BombParty-Genius/master/src/icons/favicon.ico'), // Placeholder, à remplacer
    // Utilisons des sons base64 très courts pour éviter les 404 dans cet exemple sans fichiers locaux
    // Pour une vraie prod: mettre des fichiers .mp3 dans le dossier public
    type: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/pang/pop.mp3'),
    explode: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/GalaxyInvaders/explosion_02.mp3'),
    error: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/assets/sounddogs/missile.mp3')
};
Object.values(audioCtx).forEach(a => a.volume = 0.4);

function playSound(name) {
    if(audioCtx[name]) {
        audioCtx[name].currentTime = 0;
        audioCtx[name].play().catch(e => console.log("Audio bloqué par le navigateur:", e));
    }
}

// State
let myId = null;
let isAdmin = false;
let gameActive = false;
let currentSyllable = "";
let localPlayers = [];

// INIT ALPHABET UI
function initLocalAlphabet() {
    localAlphaGrid.innerHTML = '';
    const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for(let char of alpha) {
        const div = document.createElement('div');
        div.className = 'alpha-letter';
        div.id = `local-alpha-${char}`;
        div.textContent = char;
        localAlphaGrid.appendChild(div);
    }
}
initLocalAlphabet();

// CONNEXION
function joinGame() {
    const user = document.getElementById('username').value;
    if(!user) return;
    
    // Hack pour débloquer l'audio sur Chrome
    playSound('type'); 
    
    socket.emit('join-game', user);
    views.login.classList.add('hidden');
    views.game.classList.remove('hidden');
    
    document.addEventListener('click', (e) => {
        if(!e.target.closest('#chat-panel') && !e.target.closest('.settings-modal')) {
            mainInput.focus();
        }
    });
    mainInput.focus();
}

// CHAT TOGGLE
function toggleChat() {
    document.getElementById('chat-panel').classList.toggle('collapsed');
}

function sendStart() { socket.emit('start-command'); }

// SETTINGS
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
    const canEdit = isAdmin && !gameActive;
    document.getElementById('settings-content').style.pointerEvents = canEdit ? 'auto' : 'none';
    document.getElementById('settings-lock-msg').classList.toggle('hidden', canEdit);
    document.getElementById('save-settings-btn').classList.toggle('hidden', !canEdit);
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

// CHAT LOGIC
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim() !== "") {
        socket.emit('send-message', e.target.value);
        e.target.value = "";
    }
});

function addLog(data) {
    const div = document.createElement('div');
    if (data.type === 'system') {
        div.className = 'msg-system';
        div.textContent = `${data.time} ${data.text}`;
    } else {
        div.className = 'msg-player';
        div.innerHTML = `<span class="time">${data.time}</span> <span class="user">${data.user}:</span> ${data.text}`;
    }
    chatFeed.appendChild(div);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

// LAYOUT
function updateLayout(players) {
    localPlayers = players;
    pContainer.innerHTML = "";
    const radius = Math.min(arena.offsetWidth, arena.offsetHeight) * 0.35;
    const centerX = arena.offsetWidth / 2;
    const centerY = arena.offsetHeight / 2;

    players.forEach((p, index) => {
        const angle = (index / players.length) * 2 * Math.PI - (Math.PI / 2);
        p.angle = angle;
        
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        const card = document.createElement('div');
        card.className = `player-card ${p.lives <= 0 ? 'dead' : ''}`;
        card.id = `card-${p.id}`;
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;

        const hearts = '❤️'.repeat(p.lives);
        
        card.innerHTML = `
            <div class="lives" id="lives-${p.id}">${hearts}</div>
            <div class="avatar">${['🤖','👽','🦊','🐱','🐯','🐸'][p.avatar]}</div>
            <div class="username">${p.username}</div>
            <div class="typing-box" id="type-${p.id}"></div>
        `;
        pContainer.appendChild(card);
    });
}

// GAME INPUT
mainInput.addEventListener('input', () => {
    socket.emit('typing', mainInput.value);
    playSound('type');
});
mainInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
        socket.emit('submit-word', mainInput.value);
        mainInput.value = '';
    }
});

function updateTyping(id, text) {
    const box = document.getElementById(`type-${id}`);
    if(!box) return;
    
    // Afficher la boite seulement si y'a du texte
    box.style.display = text ? 'block' : 'none';
    
    if(currentSyllable && text) {
        const reg = new RegExp(`(${currentSyllable})`, 'i');
        box.innerHTML = text.replace(reg, '<span class="hl">$1</span>');
    } else {
        box.textContent = text;
    }
}

// SOCKET EVENTS
socket.on('init-settings', (s) => {
    document.getElementById('set-lives').value = s.initialLives;
    document.getElementById('set-min').value = s.minTime;
    document.getElementById('set-max').value = s.maxTime;
});

socket.on('update-players', (data) => {
    isAdmin = (data.adminId === socket.id);
    // Masquer le bouton start si la partie est déjà active
    if (!gameActive && isAdmin && data.players.length >= 2) {
        document.getElementById('start-overlay').classList.remove('hidden');
    } else {
        document.getElementById('start-overlay').classList.add('hidden');
    }
    updateLayout(data.players);
});

socket.on('game-started', (players) => {
    gameActive = true;
    document.getElementById('start-overlay').classList.add('hidden');
    updateLayout(players);
    // Reset alphabet visuel
    document.querySelectorAll('.alpha-letter').forEach(d => d.className = 'alpha-letter');
});

socket.on('chat-message', addLog);

socket.on('new-turn', (data) => {
    currentSyllable = data.syllable;
    document.getElementById('syllable-display').textContent = data.syllable;
    
    const target = localPlayers.find(p => p.id === data.playerId);
    if (target) {
        const deg = (target.angle * 180 / Math.PI) + 90; 
        pointer.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    }

    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
    const active = document.getElementById(`card-${data.playerId}`);
    if(active) active.classList.add('active');

    // Reset typing displays
    document.querySelectorAll('.typing-box').forEach(b => { b.innerHTML = ''; b.style.display = 'none'; });
    mainInput.value = "";
    if(data.playerId === socket.id) mainInput.focus();
});

socket.on('player-typing', (d) => updateTyping(d.id, d.text));

socket.on('word-success', (data) => {
    // Si c'est moi, update sidebar
    if(data.playerId === socket.id) {
        playSound('type'); // Son de validation
        if(data.resetAlphabet) {
            document.querySelectorAll('.alpha-letter').forEach(d => d.className = 'alpha-letter');
        } else {
            data.newLetters.forEach(c => {
                document.getElementById(`local-alpha-${c}`).classList.add('found');
            });
        }
    }
    // Update Vies sur le joueur
    const lifeDiv = document.getElementById(`lives-${data.playerId}`);
    if(lifeDiv) lifeDiv.textContent = '❤️'.repeat(data.lives);
});

socket.on('word-error', () => playSound('error'));

socket.on('explosion', (data) => {
    playSound('explode');
    const bomb = document.getElementById('bomb');
    bomb.style.transform = "translate(-50%, -50%) scale(1.5)";
    setTimeout(() => bomb.style.transform = "translate(-50%, -50%) scale(1)", 300);
    const lifeDiv = document.getElementById(`lives-${data.loserId}`);
    if(lifeDiv) lifeDiv.textContent = '❤️'.repeat(data.livesLeft);
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

window.addEventListener('resize', () => { if(localPlayers.length > 0) updateLayout(localPlayers); });